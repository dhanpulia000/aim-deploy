// Reports 컨트롤러

const path = require('path');
const reportsService = require('../services/reports.service');
const excelReportService = require('../services/excelReport.service');
const weeklyReportService = require('../services/weeklyReport.service');
const weeklyVocReportService = require('../services/weeklyVocReportFromExcel.service');
const weeklyVocReportPcService = require('../services/weeklyVocReportFromExcelPc.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');
const { prisma } = require('../libs/db');

/**
 * 에이전트별 보고서 목록 조회
 */
const getReportsByAgent = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const reports = await reportsService.getReportsByAgent(agentId);
  sendSuccess(res, reports, 'Reports retrieved successfully');
});

/**
 * 보고서 생성
 */
const createReport = asyncMiddleware(async (req, res) => {
  const reportData = req.body;
  
  if (!reportData.agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const report = await reportsService.createReport(reportData);
  sendSuccess(res, report, 'Report created successfully', HTTP_STATUS.CREATED);
});

/**
 * 보고서 업데이트
 */
const updateReport = asyncMiddleware(async (req, res) => {
  const { reportId } = req.params;
  const updateData = req.body;
  
  if (!reportId) {
    return sendValidationError(res, [{ field: 'reportId', message: 'Report ID is required' }]);
  }
  
  const report = await reportsService.updateReport(reportId, updateData);
  sendSuccess(res, report, 'Report updated successfully');
});

/**
 * 보고서 삭제
 */
const deleteReport = asyncMiddleware(async (req, res) => {
  const { agentId, reportId } = req.params;
  
  if (!agentId || !reportId) {
    return sendValidationError(res, [
      { field: 'agentId', message: 'Agent ID is required' },
      { field: 'reportId', message: 'Report ID is required' }
    ]);
  }
  
  await reportsService.deleteReport(reportId);
  sendSuccess(res, null, 'Report deleted successfully', HTTP_STATUS.NO_CONTENT);
});

/**
 * Excel 보고서 업로드 및 파싱
 */
const uploadExcelReport = asyncMiddleware(async (req, res) => {
  const { agentId, fileType, projectId } = req.body;
  const file = req.file;
  
  if (!file) {
    logger.warn('File upload attempt without file', { body: req.body });
    return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
  }
  
  if (!agentId) {
    logger.warn('File upload attempt without agentId', { fileName: file.originalname });
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  if (!fileType) {
    logger.warn('File upload attempt without fileType', { fileName: file.originalname, agentId });
    return sendValidationError(res, [{ field: 'fileType', message: 'File type is required' }]);
  }
  
  logger.info('Starting Excel report upload', { 
    fileName: file.originalname, 
    fileSize: file.size, 
    fileType, 
    agentId,
    uploadPath: file.path
  });
  
  try {
    // 파일 존재 확인
    const fs = require('fs');
    if (!fs.existsSync(file.path)) {
      throw new Error(`Uploaded file not found at ${file.path}`);
    }
    
    // 파일명 인코딩 처리
    let fileName = file.originalname;
    try {
      fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      logger.warn('Filename encoding conversion failed, using original', { originalName: file.originalname, error: e.message });
    }
    
    // Excel 파일 읽기
    logger.debug('Reading Excel file', { path: file.path, size: file.size });
    const XLSX = require('xlsx');
    let workbook;
    try {
      workbook = XLSX.readFile(file.path);
      logger.debug('Excel file read successfully', { 
        sheetNames: workbook.SheetNames,
        sheetCount: workbook.SheetNames.length 
      });
    } catch (excelError) {
      logger.error('Excel file read failed', { 
        error: excelError.message, 
        path: file.path,
        code: excelError.code 
      });
      throw new Error(`Excel 파일 읽기 실패: ${excelError.message}`);
    }
    
    const fileData = {
      workbook,
      path: file.path,
      originalName: fileName
    };
    
    // 보고서 파싱 및 저장
    logger.info('Parsing and saving report', { agentId, fileType, fileName });
    const report = await reportsService.parseAndSaveExcelReport(
      fileData,
      agentId,
      fileType,
      fileName,
      projectId
    );
    
    logger.info('Report parsed and saved successfully', { 
      reportId: report.id, 
      agentId, 
      fileType 
    });
    
    // 업로드된 파일 삭제 (실패해도 서비스 영향 없도록 보호)
    try {
    fs.unlinkSync(file.path);
      logger.debug('Uploaded temp file removed', { path: file.path });
    } catch (e) {
      logger.warn('Failed to remove uploaded file', { error: e.message, path: file.path });
    }
    
    sendSuccess(res, report, 'Excel report uploaded and processed successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Excel report upload failed', { 
      error: error.message, 
      stack: error.stack,
      agentId, 
      fileType,
      fileName: file.originalname,
      fileSize: file.size
    });
    
    // 업로드된 파일이 있으면 정리 시도
    if (file && file.path) {
      try {
        const fs = require('fs');
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          logger.debug('Cleaned up temp file after error', { path: file.path });
        }
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp file after error', { 
          error: cleanupError.message, 
          path: file.path 
        });
      }
    }
    
    // 사용자에게 더 자세한 에러 메시지 제공
    const errorMessage = error.message || 'Excel report processing failed';
    sendError(res, errorMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR, process.env.NODE_ENV === 'development' ? error.stack : undefined);
  }
});

/**
 * 보고서 통계 조회
 */
const getReportStatistics = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  const { dateRange = 'week' } = req.query;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const statistics = await reportsService.getReportStatistics(agentId, dateRange);
  sendSuccess(res, statistics, 'Report statistics retrieved successfully');
});

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return [
      { field: 'startDate', message: 'Start date is required (YYYY-MM-DD format)' },
      { field: 'endDate', message: 'End date is required (YYYY-MM-DD format)' }
    ];
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return [{ field: 'date', message: 'Date format must be YYYY-MM-DD' }];
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) {
    return [{ field: 'date', message: 'Start date must be before or equal to end date' }];
  }

  return null;
}

/**
 * 일일 보고서 엑셀 다운로드
 * @route GET /api/reports/daily/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
const downloadDailyReport = asyncMiddleware(async (req, res) => {
  const { startDate, endDate } = req.query;

  const validationErrors = validateDateRange(startDate, endDate);
  if (validationErrors) {
    return sendValidationError(res, validationErrors);
  }
  
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    
    // 프로젝트 정보 가져오기 (파일명에 사용)
    let projectName = '';
    if (projectId) {
      try {
        const { queryOne } = require('../libs/db');
        const project = queryOne('SELECT name FROM Project WHERE id = ?', [projectId]);
        if (project && project.name) {
          // 파일명에 사용 가능하도록 특수문자 제거
          projectName = project.name.replace(/[<>:"/\\|?*]/g, '_').trim();
          if (projectName) {
            projectName = `_${projectName}`;
          }
        }
      } catch (error) {
        logger.warn('Failed to load project name for filename', { projectId, error: error.message });
      }
    }
    
    const buffer = await excelReportService.generateDailyReport(startDate, endDate, projectId);
    const fileName = `daily_report${projectName}_${startDate}_${endDate}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
    
    logger.info('Daily report Excel file downloaded', { startDate, endDate, projectId, projectName, fileName, size: buffer.length });
  } catch (error) {
    logger.error('Failed to download daily report Excel file', {
      error: error.message,
      stack: error.stack,
      startDate,
      endDate
    });
    sendError(res, 'Failed to generate daily report Excel file', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 주간 SUMMARY 보고서 다운로드
 * @route GET /api/reports/weekly/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&platform=pc|mobile
 */
const downloadWeeklyReport = asyncMiddleware(async (req, res) => {
  const { startDate, endDate, platform = 'pc' } = req.query;

  const validationErrors = validateDateRange(startDate, endDate);
  if (validationErrors) {
    return sendValidationError(res, validationErrors);
  }

  try {
    const buffer = await weeklyReportService.generateWeeklyReport(startDate, endDate, platform);
    const fileName = `weekly_report_${platform}_${startDate}_${endDate}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);

    logger.info('Weekly summary Excel file downloaded', { startDate, endDate, platform, fileName, size: buffer.length });
  } catch (error) {
    logger.error('Failed to download weekly summary Excel file', {
      error: error.message,
      stack: error.stack,
      startDate,
      endDate,
      platform
    });
    sendError(res, 'Failed to generate weekly report Excel file', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 엑셀 파일로부터 주간 보고서 생성 및 다운로드
 * @route POST /api/reports/weekly/from-excel
 * @body {File} file - 일일 보고서 엑셀 파일
 * @body {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @body {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @body {number} projectId - 프로젝트 ID (선택, 1: PC, 2: Mobile)
 */
const generateWeeklyReportFromExcel = asyncMiddleware(async (req, res) => {
  const { startDate, endDate, projectId } = req.body;
  const file = req.file;

  if (!file) {
    return sendValidationError(res, [{ field: 'file', message: 'Excel file is required' }]);
  }

  const validationErrors = validateDateRange(startDate, endDate);
  if (validationErrors) {
    // 업로드된 파일 정리
    if (file && file.path) {
      try {
        const fs = require('fs');
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp file after validation error', { error: cleanupError.message });
      }
    }
    return sendValidationError(res, validationErrors);
  }

  try {
    const fs = require('fs');
    
    // 파일 존재 확인
    if (!fs.existsSync(file.path)) {
      throw new Error(`Uploaded file not found at ${file.path}`);
    }

    // projectId 파싱 (선택사항)
    const parsedProjectId = projectId ? parseInt(projectId) : null;

    logger.info('Generating weekly report from Excel', {
      fileName: file.originalname,
      fileSize: file.size,
      startDate,
      endDate,
      projectId: parsedProjectId,
      uploadPath: file.path
    });

    // 주간 보고서 생성
    let buffer;
    try {
      buffer = await weeklyReportService.generateWeeklyReportFromExcel(
        file.path,
        startDate,
        endDate,
        parsedProjectId
      );
    } catch (error) {
      // 데이터가 없는 경우 더 명확한 에러 메시지 제공
      if (error.message && error.message.includes('데이터가 없습니다')) {
        throw new Error(`선택한 기간(${startDate} ~ ${endDate})에 해당하는 데이터가 엑셀 파일에 없습니다. 엑셀 파일의 실제 날짜 범위를 확인해주세요.`);
      }
      throw error;
    }

    // 업로드된 임시 파일 삭제
    try {
      fs.unlinkSync(file.path);
      logger.debug('Uploaded temp file removed', { path: file.path });
    } catch (cleanupError) {
      logger.warn('Failed to remove uploaded file', { error: cleanupError.message, path: file.path });
    }

    // 파일명 생성
    const platform = parsedProjectId === 2 ? 'mobile' : 'pc';
    const fileName = `weekly_report_from_excel_${platform}_${startDate}_${endDate}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);

    logger.info('Weekly report generated from Excel and downloaded', {
      startDate,
      endDate,
      projectId: parsedProjectId,
      fileName,
      size: buffer.length
    });
  } catch (error) {
    logger.error('Failed to generate weekly report from Excel', {
      error: error.message,
      stack: error.stack,
      startDate,
      endDate,
      projectId,
      fileName: file.originalname,
      fileSize: file.size
    });

    // 업로드된 파일 정리
    if (file && file.path) {
      try {
        const fs = require('fs');
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          logger.debug('Cleaned up temp file after error', { path: file.path });
        }
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp file after error', {
          error: cleanupError.message,
          path: file.path
        });
      }
    }

    sendError(res, 'Failed to generate weekly report from Excel file', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

// --- PUBGM 주간보고서 (VoC 소스/산출물) ---

const listWeeklySources = asyncMiddleware(async (req, res) => {
  const platform = req.query?.platform === 'pc' ? 'pc' : 'mobile';
  const list = await weeklyVocReportService.listSources(platform);
  sendSuccess(res, list);
});

const uploadWeeklySource = asyncMiddleware(async (req, res) => {
  if (!req.file || !req.file.filename) {
    return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
  }
  sendSuccess(res, { sourceId: req.file.filename, name: req.file.filename, size: req.file.size }, 'Source file uploaded', HTTP_STATUS.CREATED);
});

const deleteWeeklySource = asyncMiddleware(async (req, res) => {
  const sourceId = req.params.sourceId ? decodeURIComponent(req.params.sourceId) : '';
  const platform = req.query?.platform === 'pc' ? 'pc' : 'mobile';
  if (!sourceId) {
    return sendValidationError(res, [{ field: 'sourceId', message: 'Source ID is required' }]);
  }
  try {
    await weeklyVocReportService.deleteSource(sourceId, platform);
    sendSuccess(res, null, 'Source deleted', HTTP_STATUS.NO_CONTENT);
  } catch (e) {
    if (e.message === '파일을 찾을 수 없습니다.') {
      return sendError(res, '파일을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    }
    throw e;
  }
});

const generateWeeklyVocReport = asyncMiddleware(async (req, res) => {
  const { sourceId, useAutoPeriod, startDate, endDate, platform } = req.body || {};
  if (!sourceId) {
    return sendValidationError(res, [{ field: 'sourceId', message: 'sourceId is required' }]);
  }
  const plat = platform === 'pc' ? 'pc' : 'mobile';
  const decoded = decodeURIComponent(String(sourceId));
  const safeName = path.basename(decoded).replace(/\.\./g, '').replace(/[/\\]/g, '') || 'source.xlsx';
  const sourcePath = path.join(weeklyVocReportService.getSourcesDir(plat), safeName);
  const fs = require('fs');
  if (!fs.existsSync(sourcePath)) {
    return sendError(res, '파일을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
  }
  if (startDate && endDate && startDate > endDate) {
    return sendError(res, '시작일은 종료일보다 클 수 없습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
  try {
    const result = await weeklyVocReportService.generateReport(sourcePath, {
      useAutoPeriod: useAutoPeriod ? 1 : 0,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      platform: plat
    }, sourceId);
    sendSuccess(res, result, result.message || '산출물이 생성되었습니다.', HTTP_STATUS.CREATED);
  } catch (e) {
    if (e.message === 'VoC 시트가 없습니다.') {
      return sendError(res, 'VoC 시트가 없습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    if (e.message === 'VoC 시트에 유효한 데이터가 없습니다.') {
      return sendError(res, 'VoC 시트에 유효한 데이터가 없습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    if (e.message && e.message.includes('기간 형식')) {
      return sendError(res, e.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    if (e.message && e.message.includes('시작일은 종료일')) {
      return sendError(res, e.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    logger.error('Failed to generate PUBGM weekly report', { error: e.message, sourceId });
    sendError(res, e.message || '산출물 생성에 실패했습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

const listWeeklyOutputs = asyncMiddleware(async (req, res) => {
  const platform = req.query?.platform === 'pc' ? 'pc' : 'mobile';
  const list = await weeklyVocReportService.listOutputs(platform);
  sendSuccess(res, list);
});

const downloadWeeklyOutput = asyncMiddleware(async (req, res) => {
  const { job, file: fileName, platform } = req.query;
  if (!job || !fileName) {
    return sendValidationError(res, [{ field: 'job', message: 'job and file are required' }]);
  }
  const plat = platform === 'pc' ? 'pc' : 'mobile';
  const filePath = weeklyVocReportService.getOutputFilePath(job, fileName, plat);
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    logger.warn('[WeeklyOutputs] download 파일 없음', {
      job,
      fileName,
      platform: plat,
      resolvedPath: filePath
    });
    return sendError(res, '파일을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.sendFile(path.resolve(filePath));
});

const deleteWeeklyOutput = asyncMiddleware(async (req, res) => {
  const { jobId } = req.params;
  const platform = req.query?.platform === 'pc' ? 'pc' : 'mobile';
  if (!jobId) {
    return sendValidationError(res, [{ field: 'jobId', message: 'jobId is required' }]);
  }
  await weeklyVocReportService.deleteOutput(jobId, platform);
  sendSuccess(res, null, 'Output deleted', HTTP_STATUS.NO_CONTENT);
});

// --- PUBG PC 주간보고서 (VoC 소스/산출물) ---

const listWeeklyPcSources = asyncMiddleware(async (req, res) => {
  const list = await weeklyVocReportPcService.listSources();
  sendSuccess(res, list);
});

const uploadWeeklyPcSource = asyncMiddleware(async (req, res) => {
  if (!req.file || !req.file.filename) {
    return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
  }
  sendSuccess(res, { sourceId: req.file.filename, name: req.file.filename, size: req.file.size }, 'Source file uploaded', HTTP_STATUS.CREATED);
});

const deleteWeeklyPcSource = asyncMiddleware(async (req, res) => {
  const sourceId = req.params.sourceId ? decodeURIComponent(req.params.sourceId) : '';
  if (!sourceId) {
    return sendValidationError(res, [{ field: 'sourceId', message: 'Source ID is required' }]);
  }
  try {
    await weeklyVocReportPcService.deleteSource(sourceId);
    sendSuccess(res, null, 'Source deleted', HTTP_STATUS.NO_CONTENT);
  } catch (e) {
    if (e.message === '파일을 찾을 수 없습니다.') {
      return sendError(res, '파일을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    }
    throw e;
  }
});

const generateWeeklyPcVocReport = asyncMiddleware(async (req, res) => {
  const { sourceId, periodMode, startDate, endDate } = req.body || {};
  if (!sourceId) {
    return sendValidationError(res, [{ field: 'sourceId', message: 'sourceId is required' }]);
  }
  const decoded = decodeURIComponent(String(sourceId));
  const safeName = path.basename(decoded).replace(/\.\./g, '').replace(/[/\\]/g, '') || 'source.xlsx';
  const sourcePath = path.join(weeklyVocReportPcService.SOURCES_DIR, safeName);
  const fs = require('fs');
  if (!fs.existsSync(sourcePath)) {
    return sendError(res, '파일을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
  }
  if (periodMode === 'custom' && startDate && endDate && startDate > endDate) {
    return sendError(res, '시작일은 종료일보다 클 수 없습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
  try {
    const result = await weeklyVocReportPcService.generateReport(sourcePath, {
      periodMode: periodMode === 'custom' ? 'custom' : 'auto',
      startDate: periodMode === 'custom' ? startDate : undefined,
      endDate: periodMode === 'custom' ? endDate : undefined
    }, sourceId);
    sendSuccess(res, result, result.message || '산출물이 생성되었습니다.', HTTP_STATUS.CREATED);
  } catch (e) {
    if (e.message === 'VoC 시트가 없습니다.') {
      return sendError(res, 'VoC 시트가 없습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    if (e.message === 'VoC 시트에 유효한 데이터가 없습니다.' || e.message === '유효한 데이터가 없습니다.') {
      return sendError(res, 'VoC 시트에 유효한 데이터가 없습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    if (e.message && e.message.includes('시작일은 종료일보다')) {
      return sendError(res, e.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    sendError(res, e.message || '산출물 생성에 실패했습니다.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

const listWeeklyPcOutputs = asyncMiddleware(async (req, res) => {
  const list = await weeklyVocReportPcService.listOutputs();
  sendSuccess(res, list);
});

const downloadWeeklyPcOutput = asyncMiddleware(async (req, res) => {
  const { jobId, file: fileName } = req.query;
  if (!jobId || !fileName) {
    return sendValidationError(res, [{ field: 'jobId', message: 'jobId and file are required' }]);
  }
  const filePath = weeklyVocReportPcService.getOutputFilePath(jobId, fileName);
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    return sendError(res, '파일을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.sendFile(path.resolve(filePath));
});

const deleteWeeklyPcOutput = asyncMiddleware(async (req, res) => {
  const { jobId } = req.params;
  if (!jobId) {
    return sendValidationError(res, [{ field: 'jobId', message: 'jobId is required' }]);
  }
  await weeklyVocReportPcService.deleteOutput(jobId);
  sendSuccess(res, null, 'Output deleted', HTTP_STATUS.NO_CONTENT);
});

module.exports = {
  getReportsByAgent,
  createReport,
  updateReport,
  deleteReport,
  uploadExcelReport,
  getReportStatistics,
  downloadDailyReport,
  downloadWeeklyReport,
  generateWeeklyReportFromExcel,
  listWeeklySources,
  uploadWeeklySource,
  deleteWeeklySource,
  generateWeeklyVocReport,
  listWeeklyOutputs,
  downloadWeeklyOutput,
  deleteWeeklyOutput,
  listWeeklyPcSources,
  uploadWeeklyPcSource,
  deleteWeeklyPcSource,
  generateWeeklyPcVocReport,
  listWeeklyPcOutputs,
  downloadWeeklyPcOutput,
  deleteWeeklyPcOutput
};
