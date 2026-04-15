/**
 * 업무 알림 스케줄러 워커
 *
 * 등록된 업무 알림을 주기적으로 확인하여 지정된 시간에 LINE 메시지를 전송합니다.
 * LINE은 설정된 시간에 반드시 1건만 전송되도록 처리합니다.
 * (전송 직후 즉시 완료 처리하여 같은 알림이 다음 주기에서 다시 전송되지 않도록 함)
 */

const path = require('path');
// .env 파일 경로: 워커는 backend/workers/ 디렉토리에 있으므로 ../.env
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../libs/db');
const logger = require('../utils/logger');
const workNotificationService = require('../services/workNotification.service');
const lineService = require('../services/line.service');
const discordService = require('../services/discord.service');

// 설정
const CHECK_INTERVAL_MS = 60000; // 1분마다 확인

let checkInterval = null;
let isRunning = false;

/**
 * 전송 대기 중인 알림 확인 및 전송
 */
async function checkAndSendNotifications() {
  if (isRunning) {
    logger.debug('[TaskNotificationWorker] Already running, skipping check');
    return;
  }

  isRunning = true;

  try {
    // 현재 시간 기준 전송 대기 중인 알림 조회
    const pendingNotifications = await workNotificationService.getPendingNotifications();

    if (pendingNotifications.length === 0) {
      logger.debug('[TaskNotificationWorker] No pending notifications');
      return;
    }

    logger.info('[TaskNotificationWorker] Found pending notifications', {
      count: pendingNotifications.length
    });

    // KST 기준 오늘 날짜·시간 (getPendingNotifications와 동일하게 사용)
    const kstFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const kstParts = kstFormatter.formatToParts(new Date());
    const currentDate = `${kstParts.find(p => p.type === 'year').value}-${kstParts.find(p => p.type === 'month').value}-${kstParts.find(p => p.type === 'day').value}`; // YYYY-MM-DD (KST)
    const currentTime = `${kstParts.find(p => p.type === 'hour').value}:${kstParts.find(p => p.type === 'minute').value}`; // HH:mm (KST)

    // (시간, 채널, 내용) 기준 그룹화: 동일 내용의 중복만 1건으로 묶음. 내용이 다르면 각각 전송
    const groupKey = (n) => {
      const time = n.repeatType === 'interval' ? currentTime : (n.notificationTime || currentTime);
      const lineId = (n.lineChannelId || '').toString().trim();
      const workName = (n.workName || '').toString();
      const message = (n.message || '').toString();
      return `${time}|${lineId}|${workName}|${message}`;
    };
    const groups = new Map();
    for (const n of pendingNotifications) {
      const key = groupKey(n);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }

    logger.info('[TaskNotificationWorker] Grouped by (time, channel, content)', {
      total: pendingNotifications.length,
      groups: groups.size,
      groupSizes: [...groups.values()].map(g => g.length)
    });

    // 그룹별 1건 전송 (동일 시간·채널 = 1 LINE, 1 Discord per webhook)
    for (const [key, group] of groups) {
      const notification = group[0]; // 대표 알림 (첫 번째)
      const allIds = group.map(n => n.id);
      const displayTime = notification.repeatType === 'interval' ? currentTime : notification.notificationTime;
      const displayDate = notification.notificationDate || currentDate;

      try {
        logger.info('[TaskNotificationWorker] Sending notification (group)', {
          groupSize: group.length,
          ids: allIds,
          workName: notification.workName,
          lineChannelId: notification.lineChannelId || null,
          repeatType: notification.repeatType,
          date: displayDate,
          time: displayTime
        });

        // LINE 전송: 그룹당 1건만 (lineChannelId 있을 때)
        if (notification.lineChannelId && String(notification.lineChannelId).trim()) {
          logger.info('[TaskNotificationWorker] Sending to LINE (1 per group)', { channelId: notification.lineChannelId, groupSize: group.length });
          await lineService.sendWorkNotification(
            notification.lineChannelId,
            notification.workName,
            displayDate,
            displayTime,
            notification.message || null
          );
          logger.info('[TaskNotificationWorker] LINE send success', { channelId: notification.lineChannelId });
        }

        // 전송 완료 처리: 그룹 내 모든 알림을 한꺼번에 처리
        await workNotificationService.markManyAsSent(allIds, currentDate);

        // Discord 전송: 그룹 내 고유 웹훅별 1건씩
        const seenWebhooks = new Set();
        for (const n of group) {
          const url = (n.discordWebhookUrl || '').toString().trim();
          if (!url || seenWebhooks.has(url)) continue;
          seenWebhooks.add(url);
          try {
            logger.info('[TaskNotificationWorker] Sending to Discord', { webhook: url.slice(0, 40) + '...' });
            await discordService.sendWorkNotification(
              url,
              n.workName,
              displayDate,
              displayTime,
              n.message || null,
              n.discordMention || null
            );
            logger.info('[TaskNotificationWorker] Discord send success');
          } catch (discordError) {
            logger.error('[TaskNotificationWorker] Discord send failed (notification still marked sent)', {
              workName: n.workName,
              error: discordError.message
            });
          }
        }

        logger.info('[TaskNotificationWorker] Group sent successfully', {
          groupSize: group.length,
          sentDate: currentDate,
          lineChannelId: notification.lineChannelId || null
        });
      } catch (error) {
        const isRateLimitError = error.isRateLimit ||
          error.message.includes('API 호출 제한') ||
          error.message.includes('monthly limit') ||
          error.message.includes('429') ||
          error.statusCode === 429;

        if (isRateLimitError) {
          const now = new Date();
          const nextMonth = new Date(now);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          nextMonth.setDate(1);
          const nextMonthParts = kstFormatter.formatToParts(nextMonth);
          const nextMonthFirst = `${nextMonthParts.find(p => p.type === 'year').value}-${nextMonthParts.find(p => p.type === 'month').value}-01`;
          await workNotificationService.markManyAsSent(allIds, nextMonthFirst);
          logger.error('[TaskNotificationWorker] Line API monthly limit reached - group skipped until next month', {
            ids: allIds,
            lastSentDate: nextMonthFirst
          });
        } else {
          logger.error('[TaskNotificationWorker] Failed to send group', {
            ids: allIds,
            error: error.message,
            note: 'Will retry on next check'
          });
        }
      }
    }
  } catch (error) {
    logger.error('[TaskNotificationWorker] Error checking notifications', {
      error: error.message
    });
  } finally {
    isRunning = false;
  }
}

/**
 * 워커 시작
 */
function start() {
  if (checkInterval) {
    logger.warn('[TaskNotificationWorker] Already started');
    return;
  }

  // Line API 연결 확인 (토큰이 실제로 있을 때만; 미사용 시 스킵)
  lineService.testConnection().then((result) => {
    if (result.skipped) {
      logger.info('[TaskNotificationWorker] LINE 알림 비활성(토큰 미설정·플레이스홀더). Discord 등 다른 채널만 사용합니다.');
      return;
    }
    if (result.ok) {
      logger.info('[TaskNotificationWorker] Line API connection test successful', {
        botName: result.botName
      });
    } else {
      logger.warn('[TaskNotificationWorker] Line API connection test failed', {
        error: result.error
      });
      logger.warn('[TaskNotificationWorker] Worker will continue but notifications may fail');
    }
  }).catch((error) => {
    logger.warn('[TaskNotificationWorker] Line API connection test error', {
      error: error.message
    });
  });

  // 즉시 한 번 실행
  checkAndSendNotifications();

  // 주기적으로 실행
  checkInterval = setInterval(() => {
    checkAndSendNotifications();
  }, CHECK_INTERVAL_MS);

  logger.info('[TaskNotificationWorker] Started', {
    checkIntervalMs: CHECK_INTERVAL_MS
  });
}

/**
 * 워커 중지
 */
function stop() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    logger.info('[TaskNotificationWorker] Stopped');
  }
}

// 미처리 예외 방지 (프로세스 예기치 않은 종료 완화)
process.on('unhandledRejection', (reason) => {
  logger.error('[TaskNotificationWorker] Unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('[TaskNotificationWorker] Uncaught exception', { error: error.message, stack: error.stack });
  stop();
  process.exit(1);
});

// 프로세스 종료 시 정리
process.on('SIGTERM', () => {
  logger.info('[TaskNotificationWorker] SIGTERM received, stopping...');
  stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('[TaskNotificationWorker] SIGINT received, stopping...');
  stop();
  process.exit(0);
});

// 독립 실행 시
if (require.main === module) {
  logger.info('[TaskNotificationWorker] Starting as standalone process...');
  start();
}

module.exports = {
  start,
  stop
};
