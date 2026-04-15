// YouTube 컨트롤러
const youtubeService = require('../services/youtube.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const { createFileUploadMiddleware } = require('../services/files.service');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');

// YouTube API 클라이언트 생성 함수
function getYouTubeClient(apiKey) {
  return google.youtube({ version: 'v3', auth: apiKey });
}

/**
 * 주간 영상 메타데이터 수집 및 CSV 다운로드
 * @route POST /api/youtube/weekly-metadata
 * @body {string} apiKey - YouTube Data API v3 API 키
 * @body {string} channelId - 채널 ID
 * @body {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 */
const collectWeeklyMetadata = asyncMiddleware(async (req, res) => {
  const { apiKey, channelId, date } = req.body;
  
  if (!apiKey) {
    return sendValidationError(res, [{ field: 'apiKey', message: 'YouTube API key is required' }]);
  }
  
  if (!channelId) {
    return sendValidationError(res, [{ field: 'channelId', message: 'Channel ID is required' }]);
  }
  
  try {
    const targetDate = date ? new Date(date) : new Date();
    
    if (isNaN(targetDate.getTime())) {
      return sendValidationError(res, [{ field: 'date', message: 'Invalid date format. Use YYYY-MM-DD' }]);
    }
    
    logger.info('Collecting weekly video metadata', { channelId, date: targetDate.toISOString() });
    
    const result = await youtubeService.collectWeeklyVideoMetadata(apiKey, channelId, targetDate);
    
    sendSuccess(res, result, 'Weekly video metadata collected successfully');
  } catch (error) {
    logger.error('Failed to collect weekly metadata', { error: error.message, channelId });
    sendError(res, error.message || 'Failed to collect weekly metadata', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 주간 기간 정보 조회
 * @route GET /api/youtube/weekly-period
 * @query {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 */
const getWeeklyPeriod = asyncMiddleware(async (req, res) => {
  const { date } = req.query;
  
  try {
    const targetDate = date ? new Date(date) : new Date();
    
    if (isNaN(targetDate.getTime())) {
      return sendValidationError(res, [{ field: 'date', message: 'Invalid date format. Use YYYY-MM-DD' }]);
    }
    
    const period = youtubeService.getWeeklyPeriod(targetDate);
    
    sendSuccess(res, period, 'Weekly period calculated successfully');
  } catch (error) {
    logger.error('Failed to get weekly period', { error: error.message });
    sendError(res, error.message || 'Failed to get weekly period', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 엑셀 파일 기반 다중 채널 주간 영상 메타데이터 수집
 * @route POST /api/youtube/multi-channel-weekly
 * @body {string} apiKey - YouTube Data API v3 API 키
 * @body {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 * @file {file} excelFile - 엑셀 파일 (채널명, 유튜브 URL, 라이브 URL)
 */
const collectMultiChannelWeekly = asyncMiddleware(async (req, res) => {
  const { date } = req.body;
  const file = req.file;
  
  // YouTube API 키는 서버 측 환경 변수에서 관리
  const apiKey = process.env.YOUTUBE_API_KEY;
  
  if (!apiKey) {
    return sendError(res, 'Missing YOUTUBE_API_KEY in server configuration', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
  
  if (!file) {
    return sendValidationError(res, [{ field: 'excelFile', message: 'Excel file is required' }]);
  }
  
  try {
    const targetDate = date ? new Date(date) : new Date();
    
    if (isNaN(targetDate.getTime())) {
      return sendValidationError(res, [{ field: 'date', message: 'Invalid date format. Use YYYY-MM-DD' }]);
    }
    
    logger.info('Collecting multi-channel weekly video metadata', { 
      filePath: file.path, 
      date: targetDate.toISOString() 
    });
    
    const result = await youtubeService.collectMultiChannelWeeklyMetadata(apiKey, file.path, targetDate);
    
    // 임시 파일 삭제
    try {
      await fs.unlink(file.path);
    } catch (cleanupError) {
      logger.warn('Failed to delete temp file', { path: file.path, error: cleanupError.message });
    }
    
    sendSuccess(res, result, 'Multi-channel weekly video metadata collected successfully');
  } catch (error) {
    // 에러 발생 시에도 임시 파일 삭제 시도
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        logger.warn('Failed to delete temp file on error', { path: req.file.path });
      }
    }
    
    logger.error('Failed to collect multi-channel weekly metadata', { error: error.message });
    sendError(res, error.message || 'Failed to collect multi-channel weekly metadata', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * Excel/CSV 파일 다운로드
 * @route GET /api/youtube/download/:filename
 * @param {string} filename - 다운로드할 파일명 (URL 인코딩 가능)
 */
const downloadCSV = asyncMiddleware(async (req, res) => {
  let { filename } = req.params;
  
  if (!filename) {
    return sendError(res, 'Filename is required', HTTP_STATUS.BAD_REQUEST);
  }
  
  // URL 디코딩 (한글 파일명 처리)
  try {
    filename = decodeURIComponent(filename);
  } catch (e) {
    // 디코딩 실패 시 원본 사용
    logger.warn('Failed to decode filename', { filename, error: e.message });
  }
  
  // 파일명에 경로 조작 시도 방지
  const safeFilename = path.basename(filename);
  const filePath = path.join(__dirname, '..', 'uploads', 'youtube', safeFilename);
  
  try {
    // 파일 존재 여부 확인
    await fs.access(filePath);
    
    // 파일 확장자에 따라 Content-Type 설정
    const isXLSX = safeFilename.toLowerCase().endsWith('.xlsx');
    const isCSV = safeFilename.toLowerCase().endsWith('.csv');
    
    if (isXLSX) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else if (isCSV) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    
    // 파일 스트리밍
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('File not found', { filename: safeFilename, filePath });
      return sendError(res, 'File not found', HTTP_STATUS.NOT_FOUND);
    }
    logger.error('Failed to download file', { error: error.message, filename: safeFilename });
    sendError(res, 'Failed to download file', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

function quotaUiLocale(req) {
  const q = req.query?.lang;
  if (q === 'ko' || q === 'ko-KR') return 'ko';
  if (q === 'en' || q === 'en-US') return 'en';
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  if (al.startsWith('ko') || al.includes('ko-kr')) return 'ko';
  return 'en';
}

/**
 * YouTube API 할당량 상태 확인
 * @route GET /api/youtube/quota-status
 */
const getQuotaStatus = asyncMiddleware(async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const loc = quotaUiLocale(req);

  if (!apiKey) {
    return sendError(res, 'Missing YOUTUBE_API_KEY in server configuration', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  try {
    const youtube = getYouTubeClient(apiKey);
    const { getQuotaStatus, recordQuotaUsage } = require('../services/youtubeQuotaTracker');

    // 간단한 테스트 호출 (1 unit 소비)로 할당량 확인
    // Google Developers 채널 ID 사용 (항상 존재하는 채널)
    const testChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

    await youtube.channels.list({
      part: ['snippet'],
      id: [testChannelId]
    });

    recordQuotaUsage(1); // 테스트 호출 할당량 기록

    // 할당량 상태 조회
    const quotaStatus = getQuotaStatus();
    const nFmt = loc === 'ko' ? 'ko-KR' : 'en-US';
    const dq = quotaStatus.dailyQuota.toLocaleString(nFmt);

    const successPayload =
      loc === 'ko'
        ? {
            available: true,
            message: 'API 할당량 사용 가능',
            note: `일일 할당량: ${dq} units (UTC 기준 자정 리셋, 약 ${quotaStatus.hoursUntilReset}시간 ${quotaStatus.minutesUntilReset}분 후)`,
            dailyQuota: quotaStatus.dailyQuota,
            used: quotaStatus.used,
            remaining: quotaStatus.remaining,
            resetTime: quotaStatus.resetTime,
            hoursUntilReset: quotaStatus.hoursUntilReset,
            minutesUntilReset: quotaStatus.minutesUntilReset
          }
        : {
            available: true,
            message: 'API quota is available',
            note: `Daily quota: ${dq} units (resets at UTC midnight, in about ${quotaStatus.hoursUntilReset}h ${quotaStatus.minutesUntilReset}m)`,
            dailyQuota: quotaStatus.dailyQuota,
            used: quotaStatus.used,
            remaining: quotaStatus.remaining,
            resetTime: quotaStatus.resetTime,
            hoursUntilReset: quotaStatus.hoursUntilReset,
            minutesUntilReset: quotaStatus.minutesUntilReset
          };

    sendSuccess(res, successPayload, 'Quota available');
  } catch (error) {
    if (error.code === 403 && error.message && error.message.includes('quota')) {
      const exceededPayload =
        loc === 'ko'
          ? {
              available: false,
              message: 'API 할당량 초과',
              error: 'The request cannot be completed because you have exceeded your quota.',
              note: '할당량은 UTC 기준 자정에 리셋됩니다. Google Cloud Console에서 할당량 증가를 요청할 수도 있습니다.'
            }
          : {
              available: false,
              message: 'API quota exceeded',
              error: 'The request cannot be completed because you have exceeded your quota.',
              note: 'Quota resets at UTC midnight. You can request a higher quota in Google Cloud Console.'
            };
      sendSuccess(res, exceededPayload, 'Quota exceeded');
    } else {
      logger.error('Failed to check quota status', { error: error.message });
      const failPayload =
        loc === 'ko'
          ? {
              available: false,
              message: 'API 상태 확인 실패',
              error: error.message,
              note: 'API 키 또는 네트워크 문제일 수 있습니다.'
            }
          : {
              available: false,
              message: 'Quota check failed',
              error: error.message,
              note: 'Check your API key or network connection.'
            };
      sendSuccess(res, failPayload, 'Quota check failed');
    }
  }
});

module.exports = {
  collectWeeklyMetadata,
  collectMultiChannelWeekly,
  getWeeklyPeriod,
  downloadCSV,
  getQuotaStatus
};

