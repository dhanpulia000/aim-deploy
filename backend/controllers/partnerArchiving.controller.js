const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const partnerArchivingService = require('../services/partnerArchiving.service');

/**
 * 엑셀 파일 기반 다중 플랫폼(YouTube+TikTok) 주간 영상 메타데이터 수집
 * @route POST /api/partner-archiving/multi-channel-weekly
 * @body {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 * @file {file} excelFile - 엑셀 파일
 */
const collectMultiChannelWeekly = asyncMiddleware(async (req, res) => {
  // FormData(multipart)에서 multer가 비파일 필드를 req.body에 넣음. 쿼리 스트링 폴백
  const dateFromBody = (req.body && (req.body.date ?? req.body.Date)) ?? req.query?.date;
  const file = req.file;

  logger.info('Partner archiving request received', {
    hasFile: !!file,
    hasDate: !!dateFromBody,
    dateRaw: dateFromBody,
    bodyKeys: req.body ? Object.keys(req.body) : []
  });

  if (!file) {
    return sendValidationError(res, [{ field: 'excelFile', message: 'Excel file is required' }]);
  }

  try {
    const targetDate = dateFromBody ? new Date(dateFromBody) : new Date();
    if (isNaN(targetDate.getTime())) {
      return sendValidationError(res, [{ field: 'date', message: 'Invalid date format. Use YYYY-MM-DD' }]);
    }

    // 진행 상황 추적을 위한 jobId 생성
    const jobId = randomUUID();
    
    const resolvedFilePath = path.isAbsolute(file.path) ? file.path : path.resolve(process.cwd(), file.path);
    logger.info('Collecting partner multi-platform weekly metadata', {
      filePath: resolvedFilePath,
      date: targetDate.toISOString(),
      jobId
    });

    // 장시간 작업임을 알리는 헤더 설정 (프록시/게이트웨이 타임아웃 방지)
    res.setHeader('X-Request-Timeout', '900000'); // 15분
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Job-Id', jobId); // jobId를 헤더로 전달

    // 비동기로 수집 시작 (응답은 즉시 반환하지 않고 진행 상황을 추적)
    const result = await partnerArchivingService.collectMultiPlatformWeeklyMetadata(resolvedFilePath, targetDate, jobId);

    // 임시 파일 삭제
    try {
      await fs.unlink(resolvedFilePath);
    } catch (cleanupError) {
      logger.warn('Failed to delete temp file', { path: resolvedFilePath, error: cleanupError.message });
    }

    sendSuccess(res, result, 'Partner multi-platform weekly metadata collected successfully');
  } catch (error) {
    // 에러 발생 시에도 임시 파일 삭제 시도
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        logger.warn('Failed to delete temp file on error', { path: req.file.path });
      }
    }

    logger.error('Failed to collect partner multi-platform weekly metadata', { error: error.message });
    sendError(res, error.message || 'Failed to collect partner multi-platform weekly metadata', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 진행 상황 조회
 * @route GET /api/partner-archiving/progress/:jobId
 * @param {string} jobId
 */
const getProgress = asyncMiddleware(async (req, res) => {
  const { jobId } = req.params;
  if (!jobId) {
    return sendError(res, 'jobId is required', HTTP_STATUS.BAD_REQUEST);
  }

  const progress = partnerArchivingService.getProgress(jobId);
  if (!progress) {
    return sendError(res, 'Progress not found', HTTP_STATUS.NOT_FOUND);
  }

  return sendSuccess(res, progress);
});

/**
 * Excel 파일 다운로드
 * @route GET /api/partner-archiving/download/:filename
 * @param {string} filename
 */
const downloadFile = asyncMiddleware(async (req, res) => {
  let { filename } = req.params;
  if (!filename) {
    return sendError(res, 'Filename is required', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    filename = decodeURIComponent(filename);
  } catch (e) {
    logger.warn('Failed to decode filename', { filename, error: e.message });
  }

  const safeFilename = path.basename(filename);
  const filePath = path.join(__dirname, '..', 'uploads', 'partner-archiving', safeFilename);

  try {
    await fs.access(filePath);
    const isXlsx = safeFilename.toLowerCase().endsWith('.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader('Content-Type', isXlsx
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/octet-stream');
    res.sendFile(filePath);
  } catch (error) {
    logger.error('File download failed', { filePath, error: error.message });
    sendError(res, 'File not found', HTTP_STATUS.NOT_FOUND);
  }
});

module.exports = {
  collectMultiChannelWeekly,
  getProgress,
  downloadFile
};

