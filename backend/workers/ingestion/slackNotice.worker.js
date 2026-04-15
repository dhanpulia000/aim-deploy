/**
 * Slack 공지사항 수집 워커
 *
 * 고객사 슬랙 채널의 중요한 메시지를 자동으로 수집하여 고객사 피드백 공지로 저장합니다.
 * - 채널 필터: SLACK_NOTICE_CHANNEL_ID
 * - 작성자 필터: SLACK_NOTICE_USER_IDS (쉼표로 구분된 Slack user ID 목록, 선택)
 * - 내용 필터: isNoticeMessage(text) (키워드/이모지 기반, 선택)
 * - 자동 생성: CustomerFeedbackNotice (고객사 피드백 공지 섹션에만 표시, 이슈 큐에는 표시되지 않음)
 */

require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { query, queryOne, execute } = require('../../libs/db');
const { nanoid } = require('nanoid');
const logger = require('../../utils/logger');
const { generateScreenshotPath, ensureScreenshotDirectory } = require('../../utils/fileUtils');

// 설정
const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1000; // 기본 10분
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_NOTICE_CHANNEL_ID = process.env.SLACK_NOTICE_CHANNEL_ID;
// 특정 작성자만 공지로 인정할 경우, 해당 Slack user ID들을 설정
// - 우선순위: MonitoringConfig('slack.notice.userIds') > env(SLACK_NOTICE_USER_IDS)
let SLACK_NOTICE_USER_IDS = (process.env.SLACK_NOTICE_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// 작성자 ID와 이름 매핑 (선택 사항)
// 형식: "U12345:홍길동,U67890:김철수" 또는 JSON 형식
const SLACK_NOTICE_USER_NAMES = process.env.SLACK_NOTICE_USER_NAMES || '';
let userNamesMap = new Map();

// 매핑 파싱
if (SLACK_NOTICE_USER_NAMES) {
  try {
    // JSON 형식 시도
    const jsonMap = JSON.parse(SLACK_NOTICE_USER_NAMES);
    if (typeof jsonMap === 'object' && !Array.isArray(jsonMap)) {
      Object.entries(jsonMap).forEach(([id, name]) => {
        userNamesMap.set(id.trim(), String(name).trim());
      });
      logger.info('[SlackNoticeWorker] User names map loaded from JSON', { count: userNamesMap.size });
    }
  } catch (jsonError) {
    // JSON 파싱 실패 시 쉼표로 구분된 형식 시도: "U12345:홍길동,U67890:김철수"
    const pairs = SLACK_NOTICE_USER_NAMES.split(',')
      .map(pair => pair.trim())
      .filter(Boolean);
    
    pairs.forEach(pair => {
      const [id, name] = pair.split(':').map(s => s.trim());
      if (id && name) {
        userNamesMap.set(id, name);
      }
    });
    
    if (userNamesMap.size > 0) {
      logger.info('[SlackNoticeWorker] User names map loaded from key-value pairs', { count: userNamesMap.size });
    }
  }
}

/**
 * DB에 저장된 Slack 공지 수집 설정을 로드 (있으면 env보다 우선)
 * - slack.notice.userIds: JSON 배열
 * - slack.notice.userNames: JSON 객체
 */
function loadSlackNoticeConfigFromDB() {
  try {
    const userIdsConfig = queryOne('SELECT value FROM MonitoringConfig WHERE key = ?', ['slack.notice.userIds']);
    if (userIdsConfig?.value) {
      try {
        const parsed = JSON.parse(userIdsConfig.value);
        if (Array.isArray(parsed)) {
          SLACK_NOTICE_USER_IDS = parsed.map(v => String(v).trim()).filter(Boolean);
        }
      } catch (e) {
        // JSON이 아니면 CSV로 처리
        SLACK_NOTICE_USER_IDS = String(userIdsConfig.value)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      }
    }

    const userNamesConfig = queryOne('SELECT value FROM MonitoringConfig WHERE key = ?', ['slack.notice.userNames']);
    if (userNamesConfig?.value) {
      try {
        const parsed = JSON.parse(userNamesConfig.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          userNamesMap = new Map();
          Object.entries(parsed).forEach(([id, name]) => {
            userNamesMap.set(String(id).trim(), String(name).trim());
          });
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore (설정 테이블/키가 없을 수 있음)
  }
}

// 캐시: 채널명 / 사용자명 조회 결과 재사용 (최대 500건, LRU 방식 제한)
const CACHE_MAX_SIZE = 500;

function setCacheWithLimit(map, key, value) {
  if (map.size >= CACHE_MAX_SIZE && !map.has(key)) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

const channelNameCache = new Map();
const userNameCache = new Map();

let isRunning = false;
let scanInterval = null;
let slackClient = null;

/**
 * Slack 클라이언트 초기화
 */
function initSlackClient() {
  if (!SLACK_BOT_TOKEN) {
    logger.warn('[SlackNoticeWorker] SLACK_BOT_TOKEN not set, worker will not run');
    return null;
  }
  
  return new WebClient(SLACK_BOT_TOKEN);
}

/**
 * 메시지가 공지사항인지 확인
 * @param {string} text - 메시지 텍스트
 * @returns {boolean}
 */
function isNoticeMessage(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // "공지" 키워드 확인
  if (lowerText.includes('공지')) {
    return 1;
  }
  
  // 공지 이모지 확인
  if (text.includes('📢') || text.includes('🔔') || text.includes('📣')) {
    return 1;
  }
  
  return false;
}

/**
 * 메시지 작성자가 공지 대상으로 설정된 사용자 목록에 포함되는지 확인
 * @param {string} userId - Slack user ID (message.user)
 * @returns {boolean}
 */
function isNoticeAuthor(userId) {
  if (!userId) return false;
  if (!SLACK_NOTICE_USER_IDS.length) {
    // 설정이 없으면 작성자 필터는 사용하지 않음
    return 1;
  }
  return SLACK_NOTICE_USER_IDS.includes(userId);
}

/**
 * 채널 이름 조회 (conversations.info)
 * @param {WebClient} client
 * @param {string} channelId
 * @returns {Promise<string|null>}
 */
async function getChannelName(client, channelId) {
  if (!channelId || !client) return null;
  if (channelNameCache.has(channelId)) return channelNameCache.get(channelId);

  try {
    const info = await client.conversations.info({ channel: channelId });
    if (info.ok && info.channel?.name) {
      setCacheWithLimit(channelNameCache, channelId, info.channel.name);
      return info.channel.name;
    }
  } catch (error) {
    logger.warn('[SlackNoticeWorker] Failed to fetch channel info', {
      channelId,
      error: error.message
    });
  }
  return null;
}

/**
 * 채널 정보 조회 (이름과 team ID 포함)
 * @param {WebClient} client
 * @param {string} channelId
 * @returns {Promise<{name: string|null, teamId: string|null}>}
 */
async function getChannelInfo(client, channelId) {
  if (!channelId || !client) return { name: null, teamId: null };

  try {
    const info = await client.conversations.info({ channel: channelId });
    if (info.ok && info.channel) {
      return {
        name: info.channel.name || null,
        teamId: info.channel.context_team_id || null
      };
    }
  } catch (error) {
    logger.warn('[SlackNoticeWorker] Failed to fetch channel info', {
      channelId,
      error: error.message
    });
  }
  return { name: null, teamId: null };
}

/**
 * 사용자 이름 조회 (users.info)
 * @param {WebClient} client
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
async function getUserName(client, userId) {
  if (!userId) return null;
  
  // 1. 캐시에서 확인
  if (userNameCache.has(userId)) {
    return userNameCache.get(userId);
  }
  
  // 2. 환경 변수에서 설정된 매핑 확인
  if (userNamesMap.has(userId)) {
    const mappedName = userNamesMap.get(userId);
    setCacheWithLimit(userNameCache, userId, mappedName);
    logger.debug('[SlackNoticeWorker] User name found in mapping', { userId, name: mappedName });
    return mappedName;
  }
  
  // 3. Slack API로 조회 (client가 있는 경우)
  if (!client) return null;
  
  try {
    const info = await client.users.info({ user: userId });
    if (info.ok && info.user) {
      const name = info.user.real_name || info.user.profile?.display_name || info.user.name;
      if (name) {
        setCacheWithLimit(userNameCache, userId, name);
        return name;
      }
    }
  } catch (error) {
    logger.warn('[SlackNoticeWorker] Failed to fetch user info', {
      userId,
      error: error.message
    });
  }
  return null;
}

/**
 * 이미지 파일 찾기 함수 (개선된 버전)
 * message.files, message.blocks, message.attachments 모두 확인
 */
function findImageFile(message) {
  // 1. message.files에서 이미지 찾기 (기존 로직)
  const fileImage = (message.files || []).find(
    (file) =>
      file.mimetype?.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(file.filetype)
  );

  if (fileImage && (fileImage.url_private || fileImage.url_private_download || fileImage.url)) {
    return fileImage;
  }

  // 2. blocks에서 이미지 찾기
  if (message.blocks && Array.isArray(message.blocks)) {
    for (const block of message.blocks) {
      // image block 타입
      if (block.type === 'image' && block.image_url) {
        return {
          url_private: block.image_url || block.url_private,
          url: block.image_url,
          name: 'block_image.png',
          mimetype: 'image/png',
          filetype: 'png',
          id: `block_${block.block_id || Date.now()}`
        };
      }
      
      // section block 내부의 image element
      if (block.type === 'section' && block.accessory?.type === 'image') {
        return {
          url_private: block.accessory.image_url || block.accessory.url_private,
          url: block.accessory.image_url,
          name: 'section_accessory_image.png',
          mimetype: 'image/png',
          filetype: 'png',
          id: `block_accessory_${block.block_id || Date.now()}`
        };
      }

      // rich_text block 내부의 이미지 요소 확인
      if (block.type === 'rich_text' && block.elements && Array.isArray(block.elements)) {
        for (const element of block.elements) {
          if (element.type === 'image' && element.url) {
            return {
              url_private: element.url || element.url_private,
              url: element.url,
              name: 'pasted_image.png',
              mimetype: 'image/png',
              filetype: 'png',
              id: `rich_text_${block.block_id || Date.now()}`
            };
          }
          
          if (element.type === 'rich_text_section' && element.elements && Array.isArray(element.elements)) {
            for (const subElement of element.elements) {
              if (subElement.type === 'image' && (subElement.url || subElement.url_private)) {
                return {
                  url_private: subElement.url || subElement.url_private,
                  url: subElement.url || subElement.url_private,
                  name: 'pasted_image.png',
                  mimetype: 'image/png',
                  filetype: 'png',
                  id: `rich_text_section_${block.block_id || Date.now()}`
                };
              }
            }
          }
        }
      }
    }
  }

  // 3. attachments에서 이미지 찾기
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment.image_url || attachment.thumb_url) {
        const imageUrl = attachment.image_url || attachment.thumb_url;
        return {
          url_private: imageUrl,
          url: imageUrl,
          name: attachment.title || 'attachment_image.png',
          mimetype: 'image/png',
          filetype: 'png',
          id: `attachment_${attachment.id || Date.now()}`
        };
      }
    }
  }

  return null;
}

/**
 * 이미지 다운로드 함수 (개선된 버전)
 */
async function downloadSlackImage(imageFile, articleId) {
  try {
    const pathInfo = generateScreenshotPath(articleId);
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    // 1. url_private 우선 시도
    let downloadUrl = imageFile.url_private;
    let headers = {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`
    };

    // 2. url_private가 없으면 url_private_download 시도
    if (!downloadUrl && imageFile.url_private_download) {
      downloadUrl = imageFile.url_private_download;
      headers = {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`
      };
    }

    // 3. 공개 URL 시도
    if (!downloadUrl && imageFile.url) {
      downloadUrl = imageFile.url;
      headers = {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`
      };
    }

    if (!downloadUrl) {
      throw new Error('No valid image URL found');
    }

    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`
      },
      timeout: 60000,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
      validateStatus: (status) => status === 200
    });

    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      throw new Error('Slack 인증 실패: 이미지가 아닌 로그인 페이지(HTML)가 반환되었습니다.');
    }

    let fileExtension = 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      fileExtension = 'jpg';
    } else if (contentType.includes('gif')) {
      fileExtension = 'gif';
    } else if (contentType.includes('webp')) {
      fileExtension = 'webp';
    } else if (contentType.includes('bmp')) {
      fileExtension = 'bmp';
    } else if (contentType.includes('svg')) {
      fileExtension = 'svg';
    }

    const finalPath = pathInfo.fullPath.replace(/\.png$/, `.${fileExtension}`);
    await fs.writeFile(finalPath, response.data);

    return finalPath;
  } catch (error) {
    logger.error('[SlackNoticeWorker] Failed to download image', {
      articleId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Slack 메시지를 Issue로 변환
 */
async function processSlackMessage(message, channelId, client) {
  try {
    // 메시지 텍스트 추출
    let messageText = message.text || '';
    
    // 블록이 있으면 텍스트 추출
    if (message.blocks && Array.isArray(message.blocks)) {
      const blockTexts = message.blocks
        .map(block => {
          if (block.type === 'section' && block.text) {
            return block.text.text || block.text;
          }
          if (block.type === 'rich_text') {
            return block.elements?.map(el => el.text || '').join('') || '';
          }
          return '';
        })
        .filter(Boolean);
      
      if (blockTexts.length > 0) {
        messageText = blockTexts.join('\n\n');
      }
    }
    
    // 메시지 링크 생성
    let _messagePermalink = null;
    try {
      if (message.ts && channelId && client) {
        const permalinkResult = await client.chat.getPermalink({
          channel: channelId,
          message_ts: message.ts
        });
        if (permalinkResult.ok) {
          _messagePermalink = permalinkResult.permalink;
        }
      }
    } catch (permalinkError) {
      logger.warn('[SlackNoticeWorker] Failed to get message permalink', {
        ts: message.ts,
        error: permalinkError.message
      });
    }

    // 공지사항 필터링
    // 1) 작성자 필터: SLACK_NOTICE_USER_IDS가 설정된 경우, 해당 사용자 메시지만 처리
    const isAuthorInWhitelist = isNoticeAuthor(message.user);
    if (!isAuthorInWhitelist) {
      logger.info('[SlackNoticeWorker] Message skipped due to author filter', {
        ts: message.ts,
        user: message.user,
        messagePreview: messageText.substring(0, 50),
        configuredUsers: SLACK_NOTICE_USER_IDS
      });
      return null;
    }

    // 2) 내용 필터
    // - SLACK_NOTICE_USER_IDS가 설정된 경우: 해당 계정의 모든 메시지를 공지로 처리 (내용 필터 생략)
    // - 설정이 없으면: 기존처럼 내용 기반 공지 필터(isNoticeMessage) 사용
    if (!SLACK_NOTICE_USER_IDS.length) {
      if (!isNoticeMessage(messageText)) {
        logger.info('[SlackNoticeWorker] Message does not match notice content criteria', {
          ts: message.ts,
          user: message.user,
          messagePreview: messageText.substring(0, 100),
          hint: '메시지에 "공지", "알림", "공지사항" 키워드나 📢, 🔔, 📣 이모지가 필요합니다.'
        });
        return null;
      }
    }

    // 날짜/시간 계산 (Slack ts는 "1234567890.12345" 형식의 문자열)
    let createdAt = new Date();
    if (message.ts) {
      const tsNumber = parseFloat(message.ts) * 1000;
      if (!Number.isNaN(tsNumber)) {
        createdAt = new Date(tsNumber);
      }
    }
    
    // 이미 수집된 메시지인지 확인 (CustomerFeedbackNotice 기준)
    const timeMin = new Date(createdAt.getTime() - 60000).toISOString(); // 1분 전
    const timeMax = new Date(createdAt.getTime() + 60000).toISOString(); // 1분 후
    const existingNotice = queryOne(
      `SELECT * FROM CustomerFeedbackNotice 
       WHERE content = ? 
       AND noticeDate >= ? 
       AND noticeDate <= ? 
       AND createdBy = ? 
       LIMIT 1`,
      [messageText, timeMin, timeMax, 'slack_worker']
    );

    if (existingNotice) {
      logger.debug('[SlackNoticeWorker] Message already collected as CustomerFeedbackNotice', { 
        ts: message.ts,
        noticeId: existingNotice.id
      });
      return null;
    }
    
    const datePart = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
    const timePart = createdAt.toTimeString().slice(0, 8); // HH:MM:SS

    // 채널명 / 작성자명 조회
    // 채널 정보 조회 (이름과 team ID 포함)
    const channelInfo = await getChannelInfo(client, channelId);
    const channelName = channelInfo.name || await getChannelName(client, channelId); // fallback
    const teamId = channelInfo.teamId;
    
    // 작성자명 조회 (재시도 로직 포함)
    let authorName = await getUserName(client, message.user);
    // 작성자명을 가져오지 못한 경우 재시도 (최대 2번)
    if (!authorName && message.user) {
      logger.debug('[SlackNoticeWorker] Retrying to fetch user name', { userId: message.user });
      await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 대기
      authorName = await getUserName(client, message.user);
    }

    // 메시지에 포함된 이미지 파일 처리 (있으면 첫 번째 이미지를 스크린샷으로 사용)
    let screenshotPath = null;
    const imageFile = findImageFile(message);

    /**
     * 이미지 다운로드 함수 (개선된 버전)
     */
    async function downloadSlackImage(imageFile, articleId) {
      try {
        const pathInfo = generateScreenshotPath(articleId);
        await ensureScreenshotDirectory(pathInfo.uploadsDir);

        // 1. url_private 우선 시도
        let downloadUrl = imageFile.url_private;
        // 모든 private URL에는 인증 헤더 필수
        let headers = {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`
        };

        // 2. url_private가 없으면 url_private_download 시도 (인증 헤더 유지)
        if (!downloadUrl && imageFile.url_private_download) {
          downloadUrl = imageFile.url_private_download;
          // url_private_download도 private URL이므로 인증 헤더 필요
          headers = {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`
          };
        }

        // 3. 공개 URL 시도 (마지막 수단, 하지만 인증 헤더는 항상 포함)
        if (!downloadUrl && imageFile.url) {
          downloadUrl = imageFile.url;
          // 공개 URL이어도 Slack API는 인증 헤더를 요구할 수 있으므로 항상 포함
          headers = {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`
          };
        }

        if (!downloadUrl) {
          throw new Error('No valid image URL found');
        }

        logger.info('[SlackNoticeWorker] Downloading image for notice', {
          ts: message.ts,
          articleId,
          fileId: imageFile.id,
          url: downloadUrl,
          targetPath: pathInfo.fullPath,
          hasUrlPrivate: !!imageFile.url_private,
          hasUrlPrivateDownload: !!imageFile.url_private_download,
          hasUrl: !!imageFile.url
        });

        let response;
        try {
          // 모든 Slack 이미지 다운로드 시 Authorization 헤더 필수
          // 이 부분이 반드시 있어야 합니다!
          response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer', // 바이너리 데이터로 처리 (텍스트 변환 방지)
            headers: {
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`
            },
            timeout: 60000, // 타임아웃 증가 (60초)
            maxContentLength: 10 * 1024 * 1024, // 최대 10MB
            maxBodyLength: 10 * 1024 * 1024, // 최대 10MB
            validateStatus: (status) => status === 200
          });
        } catch (axiosError) {
          logger.error('[SlackNoticeWorker] Axios request failed', {
            ts: message.ts,
            articleId,
            url: downloadUrl,
            error: axiosError.message,
            statusCode: axiosError.response?.status,
            statusText: axiosError.response?.statusText,
            headers: axiosError.response?.headers,
            contentType: axiosError.response?.headers?.['content-type']
          });
          throw axiosError;
        }

        // Content-Type 검증: HTML이 반환되면 인증 실패로 간주
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          const errorMessage = 'Slack 인증 실패: 이미지가 아닌 로그인 페이지(HTML)가 반환되었습니다.';
          logger.error('[SlackNoticeWorker] Invalid content type detected', {
            ts: message.ts,
            articleId,
            url: downloadUrl,
            contentType,
            responseSize: response.data?.length,
            hasAuthHeader: !!headers.Authorization
          });
          throw new Error(errorMessage);
        }

        // 이미지 타입 확인
        if (!contentType.includes('image/') && !imageFile.mimetype?.startsWith('image/')) {
          logger.warn('[SlackNoticeWorker] Content type may not be an image', {
            ts: message.ts,
            articleId,
            contentType,
            imageFileMimetype: imageFile.mimetype
          });
        }

        // 파일 확장자 확인 및 조정
        let fileExtension = 'png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          fileExtension = 'jpg';
        } else if (contentType.includes('gif')) {
          fileExtension = 'gif';
        } else if (contentType.includes('webp')) {
          fileExtension = 'webp';
        } else if (contentType.includes('bmp')) {
          fileExtension = 'bmp';
        } else if (contentType.includes('svg')) {
          fileExtension = 'svg';
        }

        // 파일명에 확장자 반영
        const fileName = `issue_${articleId}.${fileExtension}`;
        const fullPath = path.join(pathInfo.uploadsDir, fileName);
        const relativePath = `screenshots/${pathInfo.dateFolder}/${fileName}`;

        await fs.writeFile(fullPath, response.data);

        logger.info('[SlackNoticeWorker] Image downloaded successfully', {
          ts: message.ts,
          articleId,
          screenshotPath: relativePath,
          fileSize: response.data.length,
          contentType,
          fileExtension
        });

        return relativePath;
      } catch (error) {
        logger.error('[SlackNoticeWorker] Failed to download image', {
          ts: message.ts,
          articleId,
          error: error.message,
          stack: error.stack,
          imageFile: {
            id: imageFile.id,
            name: imageFile.name,
            mimetype: imageFile.mimetype,
            hasUrlPrivate: !!imageFile.url_private,
            hasUrlPrivateDownload: !!imageFile.url_private_download,
            hasUrl: !!imageFile.url
          }
        });
        throw error;
      }
    }

    // 이미지 파일 찾기 및 다운로드
    try {
      // 상세 로깅 (디버깅용)
      logger.info('[SlackNoticeWorker] Processing message for images', {
        ts: message.ts,
        filesCount: message.files?.length || 0,
        files: message.files?.map(f => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          filetype: f.filetype,
          size: f.size,
          hasUrlPrivate: !!f.url_private,
          hasUrlPrivateDownload: !!f.url_private_download,
          hasUrl: !!f.url,
          url_private: f.url_private ? 'exists' : 'missing',
          url_private_download: f.url_private_download ? 'exists' : 'missing',
          url: f.url ? 'exists' : 'missing'
        })) || [],
        blocksCount: message.blocks?.length || 0,
        blocks: message.blocks?.map(b => ({
          type: b.type,
          hasImageUrl: !!(b.image_url || (b.accessory && b.accessory.image_url)),
          imageUrl: b.image_url || (b.accessory && b.accessory.image_url) || null,
          hasRichTextElements: !!(b.elements && Array.isArray(b.elements)),
          richTextImageElements: b.elements?.filter(e => e.type === 'image').map(e => ({
            hasUrl: !!e.url,
            url: e.url || null
          })) || []
        })) || [],
        attachmentsCount: message.attachments?.length || 0,
        attachments: message.attachments?.map(a => ({
          hasImageUrl: !!a.image_url,
          hasThumbUrl: !!a.thumb_url,
          imageUrl: a.image_url || a.thumb_url || null
        })) || []
      });

      const imageFile = findImageFile(message);

      if (imageFile) {
        logger.info('[SlackNoticeWorker] Image file found', {
          ts: message.ts,
          imageFile: {
            id: imageFile.id,
            hasUrlPrivate: !!imageFile.url_private,
            hasUrlPrivateDownload: !!imageFile.url_private_download,
            hasUrl: !!imageFile.url,
            mimetype: imageFile.mimetype,
            filetype: imageFile.filetype
          }
        });

        const articleId = message.ts?.replace('.', '_') || String(Date.now());
        screenshotPath = await downloadSlackImage(imageFile, articleId);
      } else {
        logger.warn('[SlackNoticeWorker] No image file found in message', {
          ts: message.ts,
          hasFiles: !!(message.files && message.files.length > 0),
          hasBlocks: !!(message.blocks && message.blocks.length > 0),
          hasAttachments: !!(message.attachments && message.attachments.length > 0),
          filesDetail: message.files?.map(f => ({
            id: f.id,
            mimetype: f.mimetype,
            filetype: f.filetype,
            hasUrlPrivate: !!f.url_private
          })) || []
        });
      }
    } catch (imageError) {
      logger.error('[SlackNoticeWorker] Failed to download image for notice', {
        ts: message.ts,
        error: imageError.message,
        stack: imageError.stack
      });
      // 이미지 다운로드 실패해도 공지사항 생성은 계속 진행
    }

    // 시스템 Report 찾기 또는 생성
    let systemAgent = queryOne('SELECT * FROM Agent WHERE id = ?', ['system']);

    if (!systemAgent) {
      const now = new Date().toISOString();
      const insertResult = execute(
        'INSERT INTO Agent (id, name, status, handling, todayResolved, avgHandleSec, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['system', 'System', 'offline', 0, 0, 0, 1, now, now]
      );
      systemAgent = queryOne('SELECT * FROM Agent WHERE id = ?', ['system']);
      logger.info('[SlackNoticeWorker] Created system agent');
    }

    let systemReport = queryOne(
      'SELECT * FROM Report WHERE agentId = ? AND reportType = ?',
      ['system', 'slack_notice_collector']
    );

    if (!systemReport) {
      const reportDate = new Date().toISOString().split('T')[0];
      const reportId = nanoid();
      const now = new Date().toISOString();
      const insertResult = execute(
        'INSERT INTO Report (id, agentId, date, fileType, fileName, reportType, status, uploadedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [reportId, 'system', reportDate, 'slack', 'slack_notice_collector', 'slack_notice_collector', 'processed', now, now, now]
      );
      systemReport = queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
      logger.info('[SlackNoticeWorker] Created system report for Slack notices');
    }

    // 공지사항 카테고리 찾기 (선택 사항)
    let noticeCategoryGroup = null;
    let noticeCategory = null;
    
    try {
      // "공지" 또는 "NOTICE" 카테고리 그룹 찾기
      noticeCategoryGroup = queryOne(
        `SELECT * FROM CategoryGroup 
         WHERE (name LIKE ? OR code LIKE ?) 
         AND isActive = ? 
         LIMIT 1`,
        ['%공지%', '%NOTICE%', 1]
      );
      
      if (noticeCategoryGroup) {
        // 해당 그룹의 활성 카테고리 찾기
        const categories = query(
          'SELECT * FROM Category WHERE categoryGroupId = ? AND isActive = ? LIMIT 1',
          [noticeCategoryGroup.id, 1]
        );
        if (categories.length > 0) {
          noticeCategory = categories[0];
        }
      }
    } catch (catError) {
      logger.warn('[SlackNoticeWorker] Failed to find notice category', { error: catError.message });
    }

    // 카테고리명 (없으면 미지정)
    const categoryName = noticeCategory?.name || noticeCategoryGroup?.name || '미지정';

    // 공지 포맷 구성
    // 요약: 날짜/시간/채널명/작성자명/카테고리
    const _summary = [
      datePart,
      timePart,
      channelName || `채널:${channelId}`,
      authorName || `작성자:${message.user || 'unknown'}`,
      categoryName
    ].join(' / ');

    // 상세: 항목별로 줄 단위 + 원문 내용
    const detailLines = [
      `날짜: ${datePart}`,
      `시간: ${timePart}`,
      `채널명: ${channelName || channelId}`,
      `작성자명: ${authorName || message.user || '알 수 없음'}`,
      `카테고리: ${categoryName}`,
      '',
      '내용:',
      messageText
    ];
    const _detail = detailLines.join('\n');

    // CustomerFeedbackNotice 자동 생성 (이슈 큐가 아닌 고객사 피드백 공지로만 처리)
    // 중복 체크는 이미 함수 시작 부분에서 수행됨
    try {
      // 게임명은 슬랙 채널명 사용 (없으면 기본값)
      const gameName = channelName || `채널:${channelId}` || '미지정';

      // 카테고리 추출 (메시지 내용에서 추출 시도, 없으면 기본값)
      const messageTextLower = messageText.toLowerCase();
      let noticeCategory = '공지';
      if (messageTextLower.includes('버그') || messageTextLower.includes('bug')) {
        noticeCategory = '버그';
      } else if (messageTextLower.includes('요청') || messageTextLower.includes('request')) {
        noticeCategory = '요청사항';
      } else if (messageTextLower.includes('문의') || messageTextLower.includes('inquiry')) {
        noticeCategory = '문의';
      }

      // 담당자명은 작성자명 사용 (ID가 아닌 이름만 사용)
      // 작성자명을 가져오지 못한 경우 "알 수 없음" 사용 (ID 표시 방지)
      const managerName = authorName || '알 수 없음';

      // CustomerFeedbackNotice 생성
      const now = new Date().toISOString();
      const noticeTitle = (messageText || '').trim().split(/\r?\n/)[0]?.trim().slice(0, 200) || '공지';
      const insertResult = execute(
        `INSERT INTO CustomerFeedbackNotice (id, title, gameName, managerName, category, content, noticeDate, screenshotPath, slackChannelId, slackTeamId, createdBy, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          null,
          noticeTitle,
          gameName,
          managerName,
          noticeCategory,
          messageText,
          createdAt.toISOString(),
          screenshotPath,
          channelId,
          teamId || null,
          'slack_worker',
          1,
          now,
          now
        ]
      );
      const feedbackNotice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [insertResult.lastInsertRowid]);

      logger.info('[SlackNoticeWorker] CustomerFeedbackNotice created from Slack message', {
        noticeId: feedbackNotice.id,
        slackMessageTs: message.ts,
        gameName: gameName,
        managerName: managerName
      });
    } catch (noticeError) {
      // CustomerFeedbackNotice 생성 실패는 로그만 남기고 계속 진행
      logger.warn('[SlackNoticeWorker] Failed to create CustomerFeedbackNotice', {
        ts: message.ts,
        error: noticeError.message,
        stack: noticeError.stack
      });
    }

    // 슬랙 메시지는 CustomerFeedbackNotice로만 처리하고 Issue는 생성하지 않음
    return null;

  } catch (error) {
    logger.error('[SlackNoticeWorker] Failed to process Slack message', {
      ts: message.ts,
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Slack 채널에서 메시지 수집
 */
async function collectSlackMessages() {
  if (!SLACK_BOT_TOKEN || !SLACK_NOTICE_CHANNEL_ID) {
    logger.warn('[SlackNoticeWorker] Configuration missing', {
      hasToken: !!SLACK_BOT_TOKEN,
      hasChannelId: !!SLACK_NOTICE_CHANNEL_ID
    });
    return;
  }

  try {
    // 매 수집 시점에 DB 설정을 다시 읽어, 관리자 화면에서 선택한 계정(작성자) 필터가 즉시 반영되도록 함
    loadSlackNoticeConfigFromDB();

    logger.info('[SlackNoticeWorker] Starting message collection', {
      channelId: SLACK_NOTICE_CHANNEL_ID,
      authorFilter: SLACK_NOTICE_USER_IDS.length ? `enabled (${SLACK_NOTICE_USER_IDS.length})` : 'disabled'
    });

    // 최근 24시간 이내 메시지만 조회
    const oldest = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

    const historyResult = await slackClient.conversations.history({
      channel: SLACK_NOTICE_CHANNEL_ID,
      oldest: oldest.toString(),
      limit: 100 // 최대 100개 메시지
    });

    if (!historyResult.ok) {
      logger.error('[SlackNoticeWorker] Failed to fetch messages', {
        error: historyResult.error
      });
      return;
    }

    const messages = historyResult.messages || [];
    logger.info('[SlackNoticeWorker] Fetched messages', {
      count: messages.length,
      channelId: SLACK_NOTICE_CHANNEL_ID
    });

    // 메시지 처리 (최신순으로 정렬되어 있으므로 역순으로 처리)
    let processedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    
    for (const message of messages.reverse()) {
      // 봇 메시지나 서브타입이 있는 메시지는 건너뛰기
      if (message.subtype || message.bot_id) {
        skippedCount++;
        continue;
      }

      // CustomerFeedbackNotice 생성 (이슈 큐가 아닌 고객사 피드백 공지로만 처리)
      const result = await processSlackMessage(message, SLACK_NOTICE_CHANNEL_ID, slackClient);
      processedCount++;
      
      // processSlackMessage가 null이 아닌 경우 (공지가 생성된 경우)
      // 실제로는 항상 null을 반환하지만, 내부에서 CustomerFeedbackNotice가 생성될 수 있음
      // 로그를 통해 확인 가능
      
      // API 레이트 리밋 방지
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 실제로 생성된 공지 개수 확인
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayNoticesResult = queryOne(
      `SELECT COUNT(*) as count FROM CustomerFeedbackNotice 
       WHERE createdBy = ? AND createdAt >= ?`,
      ['slack_worker', today.toISOString()]
    );
    const todayNotices = todayNoticesResult ? todayNoticesResult.count : 0;

    logger.info('[SlackNoticeWorker] Collection completed', {
      totalMessages: messages.length,
      processedCount,
      skippedCount,
      todayNoticesCreated: todayNotices,
      channelId: SLACK_NOTICE_CHANNEL_ID,
      authorFilter: SLACK_NOTICE_USER_IDS.length > 0 ? `enabled (${SLACK_NOTICE_USER_IDS.length} users)` : 'disabled',
      contentFilter: SLACK_NOTICE_USER_IDS.length > 0 ? 'disabled (author filter active)' : 'enabled'
    });

  } catch (error) {
    logger.error('[SlackNoticeWorker] Collection failed', {
      error: error.message,
      stack: error.stack,
      channelId: SLACK_NOTICE_CHANNEL_ID
    });
  }
}

/**
 * 워커 시작
 */
async function start() {
  if (isRunning) {
    logger.warn('[SlackNoticeWorker] Already running');
    return;
  }

  if (!SLACK_BOT_TOKEN || !SLACK_NOTICE_CHANNEL_ID) {
    logger.warn('[SlackNoticeWorker] Configuration incomplete, worker will not start', {
      hasToken: !!SLACK_BOT_TOKEN,
      hasChannelId: !!SLACK_NOTICE_CHANNEL_ID
    });
    return;
  }

  isRunning = 1;
  logger.info('[SlackNoticeWorker] Starting...');

  try {
    // Slack 클라이언트 초기화
    slackClient = initSlackClient();
    if (!slackClient) {
      logger.error('[SlackNoticeWorker] Failed to initialize Slack client');
      isRunning = false;
      return;
    }

    // 즉시 한 번 수집
    await collectSlackMessages();

    // 주기적 수집 (기본 10분)
    const intervalMs = parseInt(process.env.SLACK_NOTICE_SCAN_INTERVAL_MS) || DEFAULT_SCAN_INTERVAL_MS;
    let lastManualTriggerCheck = 0;
    scanInterval = setInterval(async () => {
      try {
        // 수동 트리거 플래그 체크 (30초마다)
        const now = Date.now();
        if (now - lastManualTriggerCheck > 30000) {
          lastManualTriggerCheck = now;
          
          const triggerConfig = queryOne(
            'SELECT * FROM MonitoringConfig WHERE key = ?',
            ['manual_slack_notice_trigger']
          );
          
          if (triggerConfig) {
            const triggerTime = parseInt(triggerConfig.value, 10);
            // 트리거가 최근 1분 이내에 설정되었으면 수집 실행
            if (now - triggerTime < 60000) {
              logger.info('[SlackNoticeWorker] Manual collection trigger detected, starting collection...');
              // 트리거 플래그 삭제 (한 번만 실행)
              try {
                const insertResult = execute('DELETE FROM MonitoringConfig WHERE key = ?', ['manual_slack_notice_trigger']);
              } catch (e) {
                // 삭제 실패해도 무시
              }
              
              await collectSlackMessages();
              return; // 수동 수집 실행했으면 정기 수집은 스킵
            }
          }
        }
        
        // 정기 수집 실행
        await collectSlackMessages();
      } catch (err) {
        logger.error('[SlackNoticeWorker] Scheduled collection failed', { error: err.message });
      }
    }, intervalMs);

    logger.info('[SlackNoticeWorker] Started', {
      intervalMs,
      intervalMin: intervalMs / 60000,
      channelId: SLACK_NOTICE_CHANNEL_ID
    });

  } catch (error) {
    logger.error('[SlackNoticeWorker] Failed to start', {
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
  logger.info('[SlackNoticeWorker] Stopping...');

  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  logger.info('[SlackNoticeWorker] Stopped');
}

// 프로세스 종료 시 정리
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

// 에러 처리
process.on('unhandledRejection', (reason) => {
  logger.error('[SlackNoticeWorker] Unhandled rejection', { error: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('[SlackNoticeWorker] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  stop().then(() => process.exit(1));
});

// 시작
start().catch(err => {
  logger.error('[SlackNoticeWorker] Startup failed', { error: err.message });
  process.exit(1);
});

