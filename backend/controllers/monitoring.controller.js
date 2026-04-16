/**
 * 모니터링 컨트롤러
 */

const monitoringService = require('../services/monitoring.service');
const slackService = require('../services/slack.service');
const crawlerGames = require('../services/crawlerGames.service');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * 워커 상태 조회
 */
async function getStatus(req, res) {
  try {
    const status = await monitoringService.getWorkerStatus();
    sendSuccess(res, status);
  } catch (error) {
    logger.error('[MonitoringController] Failed to get status', { error: error.message });
    sendError(res, '워커 상태 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 키워드 목록 조회
 */
async function getKeywords(req, res) {
  try {
    const { type, enabled } = req.query;
    const keywords = await monitoringService.getKeywords({
      type,
      enabled: enabled !== undefined ? enabled === 'true' : undefined
    });
    sendSuccess(res, keywords);
  } catch (error) {
    logger.error('[MonitoringController] Failed to get keywords', { error: error.message });
    sendError(res, '키워드 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 키워드 생성
 */
async function createKeyword(req, res) {
  try {
    const { type, word, enabled } = req.body;
    
    if (!type || !word) {
      return sendError(res, 'type과 word는 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }
    
    if (!['discord', 'naver', 'system'].includes(type)) {
      return sendError(res, 'type은 discord, naver, system 중 하나여야 합니다', HTTP_STATUS.BAD_REQUEST);
    }
    
    const keyword = await monitoringService.createKeyword({
      type,
      word,
      enabled
    });
    
    sendSuccess(res, keyword, '키워드가 생성되었습니다');
  } catch (error) {
    logger.error('[MonitoringController] Failed to create keyword', { error: error.message });
    sendError(res, '키워드 생성 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 키워드 삭제
 */
async function deleteKeyword(req, res) {
  try {
    const { id } = req.params;
    const keywordId = parseInt(id, 10);
    
    if (isNaN(keywordId)) {
      return sendError(res, '유효하지 않은 키워드 ID', HTTP_STATUS.BAD_REQUEST);
    }
    
    await monitoringService.deleteKeyword(keywordId);
    sendSuccess(res, null, '키워드가 삭제되었습니다');
  } catch (error) {
    logger.error('[MonitoringController] Failed to delete keyword', { error: error.message });
    
    if (error.code === 'P2025') {
      return sendError(res, '키워드를 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }
    
    sendError(res, '키워드 삭제 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 최근 수집 로그 조회
 */
async function getLogs(req, res) {
  try {
    const { source, isProcessed, limit, offset, startDate } = req.query;
    
    const result = await monitoringService.getRecentLogs({
      source,
      isProcessed: isProcessed !== undefined ? isProcessed === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
      startDate: startDate || undefined
    });
    
    sendSuccess(res, result);
  } catch (error) {
    logger.error('[MonitoringController] Failed to get logs', { error: error.message });
    sendError(res, '로그 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * inZOI standalone Trigger Word 알림 조회
 */
async function getInzoiStandaloneTriggerAlerts(req, res) {
  try {
    const { limit } = req.query;
    const rows = await monitoringService.getInzoiStandaloneTriggerAlerts({ limit });
    sendSuccess(res, rows);
  } catch (error) {
    logger.error('[MonitoringController] Failed to get standalone trigger alerts', { error: error.message });
    sendError(res, 'inZOI standalone trigger 알림 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * inZOI standalone Duplicate 알림 조회
 */
async function getInzoiStandaloneDuplicateAlerts(req, res) {
  try {
    const { limit } = req.query;
    const rows = await monitoringService.getInzoiStandaloneDuplicateAlerts({ limit });
    sendSuccess(res, rows);
  } catch (error) {
    logger.error('[MonitoringController] Failed to get standalone duplicate alerts', { error: error.message });
    sendError(res, 'inZOI standalone duplicate 알림 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 설정 조회
 */
async function getConfig(req, res) {
  try {
    const { key } = req.params;
    const config = await monitoringService.getConfig(key);
    
    // 설정이 없어도 404 대신 null 반환 (선택적 설정이므로)
    if (!config) {
      return sendSuccess(res, null);
    }
    
    sendSuccess(res, config);
  } catch (error) {
    logger.error('[MonitoringController] Failed to get config', { error: error.message, stack: error.stack });
    sendError(res, '설정 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
}

/**
 * 설정 저장/업데이트
 */
async function setConfig(req, res) {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    
    if (!value) {
      return sendError(res, 'value는 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }
    
    const config = await monitoringService.setConfig(key, value, description);
    sendSuccess(res, config, '설정이 저장되었습니다');
  } catch (error) {
    logger.error('[MonitoringController] Failed to set config', { error: error.message });
    sendError(res, '설정 저장 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 수동 크롤링 트리거
 */
async function triggerScan(req, res) {
  try {
    const result = await monitoringService.triggerManualScan();
    sendSuccess(res, result);
  } catch (error) {
    logger.error('[MonitoringController] Failed to trigger scan', { error: error.message });
    sendError(res, error.message || '수동 스캔 트리거 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 수동 슬랙 공지 수집 트리거
 */
async function triggerSlackNoticeCollection(req, res) {
  try {
    // (선택) 슬랙 공지 수집 작성자(계정) 필터를 요청에서 함께 저장할 수 있도록 지원
    // - userIds: Slack user ID 배열 또는 CSV 문자열
    // - userNames: { [userId]: displayName } (선택)
    const { userIds, userNames } = req.body || {};
    if (userIds !== undefined) {
      const normalized =
        Array.isArray(userIds) ? userIds :
        typeof userIds === 'string' ? userIds.split(',').map(s => s.trim()).filter(Boolean) :
        [];

      await monitoringService.setConfig(
        'slack.notice.userIds',
        JSON.stringify(normalized),
        'Slack 공지 수집 대상 작성자 Slack user ID 목록(JSON 배열)'
      );

      if (userNames && typeof userNames === 'object') {
        await monitoringService.setConfig(
          'slack.notice.userNames',
          JSON.stringify(userNames),
          'Slack 공지 수집 작성자명 매핑(JSON 객체)'
        );
      }
    }

    const result = await monitoringService.triggerSlackNoticeCollection();
    sendSuccess(res, result);
  } catch (error) {
    logger.error('[MonitoringController] Failed to trigger Slack notice collection', { error: error.message });
    sendError(res, error.message || '수동 슬랙 공지 수집 트리거 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * Slack 사용자(계정) 목록 조회 (관리자용)
 */
async function listSlackUsers(req, res) {
  try {
    const users = await slackService.getUsers();
    sendSuccess(res, users);
  } catch (error) {
    logger.error('[MonitoringController] Failed to list Slack users', { error: error.message });
    sendError(res, error.message || 'Slack 사용자 목록 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** 활성 크롤러 프로필(네이버 카페 구분) — 게시판/URL 등록 드롭다운 */
function getCrawlerGames(req, res) {
  try {
    const games = crawlerGames.listActiveCrawlerGames();
    sendSuccess(res, games);
  } catch (error) {
    logger.error('[MonitoringController] Failed to list crawler games', { error: error.message });
    sendError(res, '크롤러 프로필 목록 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  getStatus,
  getKeywords,
  createKeyword,
  deleteKeyword,
  getLogs,
  getInzoiStandaloneTriggerAlerts,
  getInzoiStandaloneDuplicateAlerts,
  getConfig,
  setConfig,
  triggerScan,
  triggerSlackNoticeCollection,
  listSlackUsers,
  getCrawlerGames
};

