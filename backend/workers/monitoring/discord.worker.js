/**
 * Discord.js 기반 Discord 모니터링 워커
 * 
 * 독립 프로세스로 실행되며, Discord 메시지를 수집하여 RawLog에 저장합니다.
 * MonitoringKeyword를 참조하여 필터링합니다.
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { query, execute } = require('../../libs/db');
const { nanoid } = require('nanoid');
const logger = require('../../utils/logger');
const { logCrawlerFailure } = require('../../utils/workerScanErrorLog');
const { retryNetworkRequest } = require('../../utils/retry');

// 설정
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CHANNEL_IDS = process.env.DISCORD_CHANNEL_IDS 
  ? process.env.DISCORD_CHANNEL_IDS.split(',').map(id => id.trim())
  : [];

let client = null;
let isRunning = false;

/**
 * MonitoringKeyword를 로드하여 필터링 키워드 목록 반환
 */
async function loadMonitoringKeywords() {
  try {
    const keywords = query(
      'SELECT word FROM MonitoringKeyword WHERE enabled = ? AND type = ?',
      [true, 'discord']
    );
    return keywords.map(k => k.word.toLowerCase());
  } catch (error) {
    logger.error('[DiscordWorker] Failed to load keywords', { error: error.message });
    return [];
  }
}

/**
 * 키워드 필터링: 내용에 키워드가 포함되어 있는지 확인
 */
function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return false; // 키워드가 없으면 매칭되지 않음
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword));
}

/**
 * RawLog에 데이터 저장
 */
async function saveRawLog(data) {
  try {
    const id = nanoid();
    const now = new Date();
    const timestamp = data.timestamp || now;
    const metadata = JSON.stringify({
      channelId: data.channelId,
      channelName: data.channelName,
      messageId: data.messageId,
      guildId: data.guildId,
      url: data.url,
      hasKeywordMatch: data.hasKeywordMatch || false
    });

    execute(
      `INSERT INTO RawLog (id, source, content, author, timestamp, isProcessed, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        'discord',
        data.content,
        data.author || null,
        timestamp.toISOString(),
        false,
        metadata,
        now.toISOString(),
        now.toISOString()
      ]
    );
    
    logger.debug('[DiscordWorker] RawLog saved', { 
      id: id,
      content: data.content?.substring(0, 50)
    });
    
    return { id, source: 'discord', content: data.content, author: data.author, timestamp, isProcessed: false, metadata };
  } catch (error) {
    logger.error('[DiscordWorker] Failed to save RawLog', { 
      error: error.message,
      messageId: data.messageId
    });
    throw error;
  }
}

/**
 * Discord 메시지 처리
 */
async function handleMessage(message) {
  // 봇 메시지는 무시
  if (message.author.bot) return;

  // 채널 필터링
  if (DISCORD_CHANNEL_IDS.length > 0 && !DISCORD_CHANNEL_IDS.includes(message.channel.id)) {
    return;
  }

  try {
    // 키워드 로드
    const keywords = await loadMonitoringKeywords();

    // 메시지 내용
    const content = message.content || '';
    const attachments = message.attachments.map(a => a.url).join('\n');
    const fullContent = `${content}\n${attachments}`.trim();

    // 키워드 매칭 확인 (필터링하지 않고 표시만)
    const hasKeywordMatch = matchesKeywords(fullContent, keywords);
    
    if (hasKeywordMatch) {
      logger.debug('[DiscordWorker] Message matches keyword', {
        messageId: message.id,
        content: content.substring(0, 50)
      });
    }

    // RawLog 저장 (모든 메시지 저장, 키워드 매칭 여부 포함)
    await saveRawLog({
      content: fullContent,
      author: message.author.username || message.author.tag,
      timestamp: message.createdAt,
      channelId: message.channel.id,
      channelName: message.channel.name,
      messageId: message.id,
      guildId: message.guild?.id || null,
      url: message.url,
      hasKeywordMatch: hasKeywordMatch // 키워드 매칭 여부
    });

    logger.info('[DiscordWorker] Message processed', {
      messageId: message.id,
      channel: message.channel.name,
      author: message.author.username
    });

  } catch (error) {
    logCrawlerFailure(
      'DiscordWorker',
      {
        messageId: message.id,
        channelId: message.channel?.id,
        channelName: message.channel?.name
      },
      error
    );
  }
}

/**
 * 워커 시작
 */
async function start() {
  if (isRunning) {
    logger.warn('[DiscordWorker] Already running');
    return;
  }

  if (!DISCORD_BOT_TOKEN) {
    logger.error('[DiscordWorker] DISCORD_BOT_TOKEN not set');
    process.exit(1);
    return;
  }

  isRunning = true;
  logger.info('[DiscordWorker] Starting...');

  try {
    // Discord 클라이언트 초기화
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    // 이벤트 핸들러
    client.once('ready', () => {
      logger.info('[DiscordWorker] Discord bot ready', {
        username: client.user?.tag,
        guilds: client.guilds.cache.size
      });
    });

    client.on('messageCreate', handleMessage);

    // 에러 핸들러 (재연결 로직 포함)
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    
    client.on('error', async (error) => {
      logger.error('[DiscordWorker] Discord client error', { 
        error: error.message,
        reconnectAttempts
      });
      
      // 재연결 시도
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && isRunning) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
        
        logger.info(`[DiscordWorker] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        
        setTimeout(async () => {
          try {
            if (client) {
              await client.destroy();
            }
            await start(); // 재시작
            reconnectAttempts = 0;
          } catch (err) {
            logCrawlerFailure('DiscordWorker', { phase: 'reconnect' }, err);
          }
        }, delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        logger.error('[DiscordWorker] Max reconnection attempts reached, exiting');
        process.exit(1);
      }
    });

    // 로그인 (재시도 로직 적용)
    await retryNetworkRequest(
      () => client.login(DISCORD_BOT_TOKEN),
      {
        maxRetries: 5,
        initialDelay: 2000,
        maxDelay: 30000,
        onRetry: (attempt, error, delay) => {
          logger.warn(`[DiscordWorker] Retry ${attempt}/5 login after ${delay}ms`, {
            error: error.message
          });
          return delay;
        }
      }
    );

    logger.info('[DiscordWorker] Started');

  } catch (error) {
    logger.error('[DiscordWorker] Failed to start', {
      error: error.message,
      stack: error.stack
    });
    isRunning = false;
    process.exit(1);
  }
}

/**
 * 워커 종료
 */
async function stop() {
  if (!isRunning) return;

  isRunning = false;
  logger.info('[DiscordWorker] Stopping...');

  if (client) {
    try {
      await client.destroy();
      client = null;
      logger.info('[DiscordWorker] Discord client destroyed');
    } catch (error) {
      logger.error('[DiscordWorker] Error destroying client', {
        error: error.message,
        stack: error.stack
      });
      client = null;
    }
  }

  logger.info('[DiscordWorker] Stopped');
  
  // 정리 완료 후 프로세스 종료
  process.exit(0);
}

// 프로세스 종료 시 정리 (강화된 버전)
process.on('SIGTERM', async () => {
  logger.info('[DiscordWorker] SIGTERM received');
  await stop();
});

process.on('SIGINT', async () => {
  logger.info('[DiscordWorker] SIGINT received');
  await stop();
});

// 예상치 못한 종료 처리
process.on('uncaughtException', async (error) => {
  logger.error('[DiscordWorker] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  await stop();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logCrawlerFailure(
    'DiscordWorker',
    { phase: 'unhandledRejection', reasonPreview: String(reason).slice(0, 500) },
    reason
  );
});

// 시작
start().catch((err) => {
  logCrawlerFailure('DiscordWorker', { phase: 'startup' }, err);
  process.exit(1);
});









