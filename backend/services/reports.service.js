// Reports 서비스

const { query, queryOne, execute, executeTransaction, safeQuery } = require('../libs/db');
const XLSX = require('xlsx');
const { parseDailyReport, parseIssueReport, parseMobileDataSheet, parseMobileIssueSheet, parseMobileVOCSheet, parseWeeklyReport } = require('../utils/excel.util');
const { getCurrentDateString } = require('../utils/dates.util');
const logger = require('../utils/logger');
const classificationRulesService = require('./classification-rules.service');

const VALID_ISSUE_STATUSES = ['OPEN', 'TRIAGED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'VERIFIED', 'CLOSED'];

function normalizeIssueStatus(status) {
  if (!status) return 'OPEN';
  const normalized = String(status).toUpperCase();
  return VALID_ISSUE_STATUSES.includes(normalized) ? normalized : 'OPEN';
}

/**
 * 에이전트별 보고서 목록 조회
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Array>} 보고서 목록
 */
async function getReportsByAgent(agentId) {
  const dbResult = safeQuery(() => {
    const reports = query(
      'SELECT * FROM Report WHERE agentId = ? ORDER BY createdAt DESC',
      [agentId]
    );
    
    // 관련 아이템들 조회
    const reportIds = reports.map(r => r.id);
    let vocItems = [];
    let issueItems = [];
    let dataItems = [];
    
    if (reportIds.length > 0) {
      const placeholders = reportIds.map(() => '?').join(',');
      vocItems = query(`SELECT * FROM ReportItemVOC WHERE reportId IN (${placeholders})`, reportIds);
      issueItems = query(`SELECT * FROM ReportItemIssue WHERE reportId IN (${placeholders})`, reportIds);
      dataItems = query(`SELECT * FROM ReportItemData WHERE reportId IN (${placeholders})`, reportIds);
    }
    
    // 아이템들을 보고서별로 그룹화
    const vocByReport = {};
    const issueByReport = {};
    const dataByReport = {};
    
    vocItems.forEach(item => {
      if (!vocByReport[item.reportId]) vocByReport[item.reportId] = [];
      vocByReport[item.reportId].push(item);
    });
    issueItems.forEach(item => {
      if (!issueByReport[item.reportId]) issueByReport[item.reportId] = [];
      issueByReport[item.reportId].push(item);
    });
    dataItems.forEach(item => {
      if (!dataByReport[item.reportId]) dataByReport[item.reportId] = [];
      dataByReport[item.reportId].push(item);
    });
    
    const formatted = reports.map(report => ({
      ...report,
      vocItems: vocByReport[report.id] || [],
      issueItems: issueByReport[report.id] || [],
      dataItems: dataByReport[report.id] || []
    }));
    
    logger.info('Reports retrieved', { agentId, count: formatted.length });
    return formatted;
  }, []);

  // DB 쿼리가 실패했거나 빈 경우, 로컬 JSON에서 폴백 로드
  if (!dbResult || dbResult.length === 0) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dataFile = path.join(__dirname, '..', 'data', 'reports.json');
      if (fs.existsSync(dataFile)) {
        const raw = fs.readFileSync(dataFile, 'utf8');
        const store = raw ? JSON.parse(raw) : { reports: [] };
        const list = (store.reports || []).filter(r => r.agentId === agentId);
        if (list.length > 0) {
          logger.warn('Serving reports from JSON fallback store', { agentId, count: list.length });
          return list;
        }
      }
    } catch (e) {
      // ignore fallback errors
    }
  }

  return dbResult;
}

/**
 * 보고서 생성
 * @param {Object} reportData - 보고서 데이터
 * @returns {Promise<Object>} 생성된 보고서
 */
async function createReport(reportData) {
  return executeTransaction(() => {
    const { nanoid } = require('nanoid');
    const reportId = nanoid();
    const now = new Date().toISOString();
    
    execute(
      'INSERT INTO Report (id, agentId, date, fileType, fileName, reportType, status, uploadedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        reportId,
        reportData.agentId,
        reportData.date || getCurrentDateString(),
        reportData.fileType || null,
        reportData.fileName || null,
        reportData.reportType || reportData.fileType || null,
        'draft',
        now,
        now,
        now
      ]
    );
    
    const report = queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
    logger.info('Report created', { reportId: report.id, agentId: report.agentId });
    return report;
  });
}

/**
 * 보고서 업데이트
 * @param {string} reportId - 보고서 ID
 * @param {Object} updateData - 업데이트 데이터
 * @returns {Promise<Object>} 업데이트된 보고서
 */
async function updateReport(reportId, updateData) {
  return executeTransaction(() => {
    const updateFields = [];
    const params = [];
    
    if (updateData.date !== undefined) {
      updateFields.push('date = ?');
      params.push(updateData.date);
    }
    if (updateData.fileType !== undefined) {
      updateFields.push('fileType = ?');
      params.push(updateData.fileType);
    }
    if (updateData.fileName !== undefined) {
      updateFields.push('fileName = ?');
      params.push(updateData.fileName);
    }
    if (updateData.reportType !== undefined) {
      updateFields.push('reportType = ?');
      params.push(updateData.reportType);
    }
    if (updateData.status !== undefined) {
      updateFields.push('status = ?');
      params.push(updateData.status);
    }
    
    if (updateFields.length === 0) {
      return queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(reportId);
    
    execute(
      `UPDATE Report SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    const report = queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
    logger.info('Report updated', { reportId, agentId: report.agentId });
    return report;
  });
}

/**
 * 보고서 삭제
 * @param {string} reportId - 보고서 ID
 * @returns {Promise<void>}
 */
async function deleteReport(reportId) {
  return executeTransaction(() => {
    // 관련 데이터 먼저 삭제
    execute('DELETE FROM ReportItemVOC WHERE reportId = ?', [reportId]);
    execute('DELETE FROM ReportItemIssue WHERE reportId = ?', [reportId]);
    execute('DELETE FROM ReportItemData WHERE reportId = ?', [reportId]);
    
    // 보고서 삭제
    execute('DELETE FROM Report WHERE id = ?', [reportId]);
    
    logger.info('Report deleted', { reportId });
  });
}

/**
 * Excel 파일 파싱 및 보고서 저장
 * @param {Object} fileData - 파일 데이터
 * @param {string} agentId - 에이전트 ID
 * @param {string} fileType - 파일 타입
 * @param {string} fileName - 파일명
 * @returns {Promise<Object>} 저장된 보고서
 */
async function parseAndSaveExcelReport(fileData, agentId, fileType, fileName, projectId) {
  const workbook = fileData.workbook;
  let parsedData = {};
  
  try {
    // 값 문자열화 보조 함수 (Prisma String 필드 강제 변환)
    const toStringSafe = (value) => {
      if (value === null || value === undefined) return '';
      return typeof value === 'string' ? value : String(value);
    };
    const toIntSafe = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const normalizedProjectId = projectId ? Number(projectId) : null;
    if (projectId && Number.isNaN(normalizedProjectId)) {
      throw new Error('Invalid projectId');
    }

    const activeRules = normalizedProjectId
      ? await classificationRulesService.loadActiveRules(normalizedProjectId)
      : [];
    if (fileType === 'pc_daily' || fileType === 'mobile_daily') {
      if (fileType === 'mobile_daily') {
        // Mobile 일일보고서는 여러 시트 파싱
        const allSheets = {};
        
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          
          if (!worksheet) {
            logger.warn('Sheet not found', { sheetName });
            return;
          }
          
          const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          // 하이퍼링크 추출
          const links = {};
          if (worksheet && worksheet['!ref']) {
            const range = XLSX.utils.decode_range(worksheet['!ref']);
            for (let row = range.s.r; row <= range.e.r; row++) {
              for (let col = range.s.c; col <= range.e.c; col++) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                const cell = worksheet[cellAddress];
                if (cell && cell.l && cell.l.Target) {
                  links[`${row}_${col}`] = cell.l.Target;
                }
              }
            }
          }
          
          allSheets[sheetName] = { data, links };
        });
        
        parsedData = {
          type: 'daily',
          issue: parseMobileIssueSheet(allSheets['Issue']?.data || [], null, allSheets['Issue']?.links),
          voc: parseMobileVOCSheet(allSheets['VoC']?.data || [], null, allSheets['VoC']?.links),
          data: parseMobileDataSheet(allSheets['Data']?.data || [], null),
        };
      } else {
        // PC 일일보고서
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        parsedData = {
          type: 'daily',
          summary: parseDailyReport(data),
          issues: parseIssueReport(data),
        };
      }
    } else if (fileType === 'issue_summary') {
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      parsedData = {
        type: 'issue',
        issues: parseIssueReport(data),
      };
    } else if (fileType === 'pc_weekly' || fileType === 'mobile_weekly') {
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      parsedData = {
        type: 'weekly',
        summary: parseWeeklyReport(data),
      };
    }
    
    // Issue 분류를 먼저 수행 (트랜잭션 밖에서)
    const issueClassifications = [];
    if (parsedData.issue && Array.isArray(parsedData.issue)) {
      const issueClassifier = require('./issueClassifier');
      const { db: dbInstance } = require('../libs/db');
      
      for (const issue of parsedData.issue) {
        const summary = toStringSafe(issue.title);
        const detail = toStringSafe(issue.detail);
        
        // 동적 카테고리 분류 (비동기)
        const classification = await issueClassifier.classifyIssueCategory({
          text: `${summary} ${detail}`,
          db: dbInstance,
          projectId: normalizedProjectId
        });
        
        issueClassifications.push({
          issue,
          classification
        });
      }
    }
    
    // 트랜잭션으로 보고서 저장 (DB 불가 시 JSON 저장으로 폴백)
    let result;
    try {
      result = executeTransaction(() => {
        // 보고서 생성
        const { nanoid } = require('nanoid');
        const reportId = nanoid();
        const now = new Date().toISOString();
        
        execute(
          'INSERT INTO Report (id, agentId, date, fileType, fileName, reportType, status, uploadedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [reportId, agentId, getCurrentDateString(), fileType, fileName, fileType, 'processed', now, now, now]
        );
        
        const report = queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
        
        // VOC 아이템 저장
        if (parsedData.voc && Array.isArray(parsedData.voc)) {
          parsedData.voc.forEach(voc => {
            const vocId = nanoid();
            execute(
              `INSERT INTO ReportItemVOC (id, reportId, date, source, category, subcategory, type, sentiment, importance, content, judgment, working, remarks, link, extraField14, extraField15, extraField16, extraField17, extraField18, extraField19, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                vocId,
                report.id,
                toStringSafe(voc.date),
                toStringSafe(voc.source),
                toStringSafe(voc.category),
                toStringSafe(voc.subcategory),
                toStringSafe(voc.type),
                toStringSafe(voc.sentiment),
                toStringSafe(voc.importance),
                toStringSafe(voc.content),
                toStringSafe(voc.judgment),
                toStringSafe(voc.working),
                toStringSafe(voc.remarks),
                toStringSafe(voc.link),
                toStringSafe((Array.isArray(voc.links) && voc.links[0]) || voc.extraField14),
                toStringSafe((Array.isArray(voc.links) && voc.links[1]) || voc.extraField15),
                toStringSafe((Array.isArray(voc.links) && voc.links[2]) || voc.extraField16),
                toStringSafe((Array.isArray(voc.links) && voc.links[3]) || voc.extraField17),
                toStringSafe((Array.isArray(voc.links) && voc.links[4]) || voc.extraField18),
                toStringSafe((Array.isArray(voc.links) && voc.links[5]) || voc.extraField19),
                now
              ]
            );
          });
        }
        
        // Issue 아이템 저장
        let createdIssueIds = [];
        for (const { issue, classification } of issueClassifications) {
          const severityValue = toIntSafe(issue.severity, 3);
          const summary = toStringSafe(issue.title);
          const detail = toStringSafe(issue.detail);

          // 기존 분류 규칙도 적용 (레거시 호환)
          const ruleResult = classificationRulesService.applyRules(
            activeRules,
            summary,
            detail,
            toStringSafe(issue.category),
            severityValue
          );

          const severityFromRule = ruleResult.severity !== undefined ? Number(ruleResult.severity) : undefined;
          const normalizedSeverity = Number.isNaN(severityFromRule) ? severityValue : severityFromRule;

          // 카테고리 우선: AI·엑셀·키워드 규칙보다 중분류 importance로 severity/importance 확정
          const categoryImportanceToSeverity = { HIGH: 1, MEDIUM: 2, LOW: 3 };
          let insertSeverity = normalizedSeverity;
          let insertImportance = classification.importance || 'MEDIUM';
          if (classification.categoryId) {
            const cat = queryOne('SELECT importance FROM Category WHERE id = ?', [classification.categoryId]);
            if (cat && cat.importance) {
              insertSeverity = categoryImportanceToSeverity[cat.importance] ?? 2;
              insertImportance = cat.importance;
            }
          }

          const issueId = nanoid();
          execute(
            `INSERT INTO ReportItemIssue (id, reportId, date, legacyCategory, detail, testResult, summary, link, time, severity, source, status, sentiment, projectId, importance, categoryGroupId, categoryId, otherGameTitle, aiClassificationReason, aiClassificationMethod, createdAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              issueId,
              report.id,
              toStringSafe(issue.date),
              toStringSafe(issue.category),
              detail,
              toStringSafe(issue.testResult),
              summary,
              toStringSafe(issue.link),
              toStringSafe(issue.time),
              insertSeverity,
              toStringSafe(issue.source || 'system'),
              normalizeIssueStatus(issue.status || 'OPEN'),
              toStringSafe(classification.sentiment || issue.sentiment || 'neu'),
              normalizedProjectId || null,
              insertImportance,
              classification.groupId || null,
              classification.categoryId || null,
              classification.otherGameTitle || null,
              classification.aiClassificationReason || null,
              classification.aiClassificationMethod || null,
              now,
              now
            ]
          );
          
          createdIssueIds.push(issueId);
        }
        
        // Data 아이템 저장
        if (parsedData.data && Array.isArray(parsedData.data)) {
          parsedData.data.forEach(data => {
            const dataId = nanoid();
            execute(
              `INSERT INTO ReportItemData (id, reportId, category, date, author, communityIssue, share, request, remarks, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                dataId,
                report.id,
                toStringSafe(data.category),
                toStringSafe(data.date),
                toStringSafe(data.author),
                toStringSafe(data.communityIssues || data.communityIssue),
                toStringSafe(data.shared || data.share),
                toStringSafe(data.requests || data.request),
                toStringSafe(data.notes || data.remarks),
                now
              ]
            );
          });
        }
        
        // 생성된 이슈 ID를 report 객체에 추가
        return {
          ...report,
          createdIssueIds
        };
      });
    } catch (dbError) {
      // 폴백: JSON 파일에 저장
      const fs = require('fs');
      const path = require('path');
      const dataDir = path.join(__dirname, '..', 'data');
      const dataFile = path.join(dataDir, 'reports.json');
      try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        let store = { reports: [] };
        if (fs.existsSync(dataFile)) {
          const raw = fs.readFileSync(dataFile, 'utf8');
          store = raw ? JSON.parse(raw) : { reports: [] };
        }
        const fallbackReport = {
          id: `local_${Date.now()}`,
          agentId,
          date: getCurrentDateString(),
          fileType,
          fileName,
          reportType: fileType,
          status: 'processed',
          uploadedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        store.reports.push(fallbackReport);
        fs.writeFileSync(dataFile, JSON.stringify(store, null, 2), 'utf8');
        logger.warn('DB unavailable. Saved report to JSON store', { path: dataFile, agentId, fileType });
        result = fallbackReport;
      } catch (fallbackError) {
        logger.error('Fallback JSON save failed', { error: fallbackError.message });
        throw dbError;
      }
    }
    
    logger.info('Excel report parsed and saved', { 
      reportId: result.id, 
      agentId, 
      fileType, 
      fileName 
    });
    
    // 생성된 이슈들을 WebSocket으로 브로드캐스트 (트랜잭션 완료 후)
    if (result.createdIssueIds && result.createdIssueIds.length > 0) {
      try {
        const publisher = require('../realtime/publisher');
        const { query } = require('../libs/db');
        
        // 생성된 이슈들을 조회하여 브로드캐스트
        const placeholders = result.createdIssueIds.map(() => '?').join(',');
        const createdIssues = query(
          `SELECT * FROM ReportItemIssue WHERE id IN (${placeholders})`,
          result.createdIssueIds
        );
        
        createdIssues.forEach(issue => {
          publisher.broadcastIssueCreated(issue);
        });
      } catch (broadcastError) {
        logger.error('Failed to broadcast created issues', { error: broadcastError.message });
        // 브로드캐스트 실패는 전체 프로세스를 실패시키지 않음
      }
    }
    
    return result;
  } catch (error) {
    logger.error('Excel report parsing failed', { 
      error: error.message, 
      agentId, 
      fileType, 
      fileName 
    });
    throw error;
  }
}

/**
 * 보고서 통계 조회
 * @param {string} agentId - 에이전트 ID
 * @param {string} dateRange - 날짜 범위
 * @returns {Promise<Object>} 보고서 통계
 */
async function getReportStatistics(agentId, dateRange = 'week') {
  return safeQuery(() => {
    const now = new Date();
    let startDate;
    
    switch (dateRange) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    
    const startDateStr = startDate.toISOString();
    
    const totalReportsResult = queryOne(
      'SELECT COUNT(*) as count FROM Report WHERE agentId = ? AND createdAt >= ?',
      [agentId, startDateStr]
    );
    const totalReports = totalReportsResult?.count || 0;
    
    const processedReportsResult = queryOne(
      'SELECT COUNT(*) as count FROM Report WHERE agentId = ? AND status = ? AND createdAt >= ?',
      [agentId, 'processed', startDateStr]
    );
    const processedReports = processedReportsResult?.count || 0;
    
    const vocCountResult = queryOne(
      `SELECT COUNT(*) as count FROM ReportItemVOC 
       WHERE reportId IN (SELECT id FROM Report WHERE agentId = ? AND createdAt >= ?)`,
      [agentId, startDateStr]
    );
    const vocCount = vocCountResult?.count || 0;
    
    const issueCountResult = queryOne(
      `SELECT COUNT(*) as count FROM ReportItemIssue 
       WHERE reportId IN (SELECT id FROM Report WHERE agentId = ? AND createdAt >= ?)`,
      [agentId, startDateStr]
    );
    const issueCount = issueCountResult?.count || 0;
    
    return {
      totalReports,
      processedReports,
      vocCount,
      issueCount,
      dateRange,
      startDate: startDate.toISOString(),
      endDate: now.toISOString()
    };
  }, {
    totalReports: 0,
    processedReports: 0,
    vocCount: 0,
    issueCount: 0,
    dateRange,
    startDate: null,
    endDate: null
  });
}

module.exports = {
  getReportsByAgent,
  createReport,
  updateReport,
  deleteReport,
  parseAndSaveExcelReport,
  getReportStatistics
};

