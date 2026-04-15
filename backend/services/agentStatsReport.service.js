const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * 에이전트 통계 엑셀 보고서 생성
 */
async function generateAgentStatsReport({ startDate, endDate, agentId, projectId }) {
  try {
    // 통계 데이터 조회
    let whereConditions = ['1=1'];
    let params = [];
    
    if (startDate) {
      // KST 기준 날짜 필터
      whereConditions.push("DATE(i.processedAt, '+9 hours') >= DATE(?)");
      params.push(startDate);
    }
    if (endDate) {
      // KST 기준 날짜 필터
      whereConditions.push("DATE(i.processedAt, '+9 hours') <= DATE(?)");
      params.push(endDate);
    }
    if (agentId) {
      whereConditions.push('i.processedBy = ?');
      params.push(agentId);
    }
    if (projectId) {
      whereConditions.push('i.projectId = ?');
      params.push(parseInt(projectId));
    }
    
    whereConditions.push('i.processedAt IS NOT NULL');
    whereConditions.push('i.processedBy IS NOT NULL');
    
    const whereClause = whereConditions.join(' AND ');
    
    // 에이전트 목록
    const agents = query(`
      SELECT DISTINCT 
        a.id,
        a.name,
        a.email
      FROM Agent a
      INNER JOIN ReportItemIssue i ON i.processedBy = a.id
      WHERE ${whereClause}
      ORDER BY a.name ASC
    `, params);
    
    // 워크북 생성
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Wallboard System';
    workbook.created = new Date();
    
    // 시트 1: 요약
    const summarySheet = workbook.addWorksheet('요약');
    summarySheet.columns = [
      { header: '에이전트', key: 'agentName', width: 15 },
      { header: '이메일', key: 'agentEmail', width: 25 },
      { header: '총 처리 건수', key: 'totalProcessed', width: 15 },
      { header: 'Sev1', key: 'sev1', width: 10 },
      { header: 'Sev2', key: 'sev2', width: 10 },
      { header: 'Sev3', key: 'sev3', width: 10 },
      { header: '긍정', key: 'pos', width: 10 },
      { header: '중립', key: 'neu', width: 10 },
      { header: '부정', key: 'neg', width: 10 },
      { header: '평균 처리시간', key: 'avgHandleTime', width: 15 },
      { header: '중앙값 처리시간', key: 'medianHandleTime', width: 15 }
    ];
    
    // 헤더 스타일
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };
    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    
    // 각 에이전트별 통계 계산 및 추가
    agents.forEach(agent => {
      const agentParams = [...params];
      const agentConditions = [...whereConditions];
      
      if (!agentId) {
        agentConditions.push('i.processedBy = ?');
        agentParams.push(agent.id);
      }
      
      const agentWhere = agentConditions.join(' AND ');
      
      // 통계 조회
      const totalResult = queryOne(`SELECT COUNT(*) as count FROM ReportItemIssue i WHERE ${agentWhere}`, agentParams);
      const severityResults = query(`SELECT severity, COUNT(*) as count FROM ReportItemIssue i WHERE ${agentWhere} GROUP BY severity`, agentParams);
      const sentimentResults = query(`SELECT sentiment, COUNT(*) as count FROM ReportItemIssue i WHERE ${agentWhere} GROUP BY sentiment`, agentParams);
      const timeResults = query(`
        SELECT (julianday(i.processedAt) - julianday(i.checkedAt)) * 86400 as handleTime
        FROM ReportItemIssue i
        WHERE ${agentWhere}
          AND i.checkedAt IS NOT NULL
          AND i.processedAt IS NOT NULL
          AND i.processedAt > i.checkedAt
        ORDER BY handleTime ASC
      `, agentParams);
      
      const severityBreakdown = { sev1: 0, sev2: 0, sev3: 0 };
      severityResults.forEach(r => {
        if (r.severity === 1) severityBreakdown.sev1 = r.count;
        if (r.severity === 2) severityBreakdown.sev2 = r.count;
        if (r.severity === 3) severityBreakdown.sev3 = r.count;
      });
      
      const sentimentBreakdown = { pos: 0, neg: 0, neu: 0 };
      sentimentResults.forEach(r => {
        if (r.sentiment === 'pos') sentimentBreakdown.pos = r.count;
        if (r.sentiment === 'neg') sentimentBreakdown.neg = r.count;
        if (r.sentiment === 'neu') sentimentBreakdown.neu = r.count;
      });
      
      let avgHandleTime = null;
      let medianHandleTime = null;
      
      if (timeResults.length > 0) {
        const times = timeResults.map(r => r.handleTime).filter(t => t > 0 && t < 86400 * 30);
        if (times.length > 0) {
          avgHandleTime = Math.round(times.reduce((sum, t) => sum + t, 0) / times.length);
          const sorted = [...times].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          medianHandleTime = sorted.length % 2 === 0
            ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
            : Math.round(sorted[mid]);
        }
      }
      
      summarySheet.addRow({
        agentName: agent.name,
        agentEmail: agent.email,
        totalProcessed: totalResult?.count || 0,
        sev1: severityBreakdown.sev1,
        sev2: severityBreakdown.sev2,
        sev3: severityBreakdown.sev3,
        pos: sentimentBreakdown.pos,
        neu: sentimentBreakdown.neu,
        neg: sentimentBreakdown.neg,
        avgHandleTime: avgHandleTime ? `${Math.floor(avgHandleTime / 60)}분 ${avgHandleTime % 60}초` : '-',
        medianHandleTime: medianHandleTime ? `${Math.floor(medianHandleTime / 60)}분 ${medianHandleTime % 60}초` : '-'
      });
    });
    
    // 시트 2: 처리한 이슈 목록
    const issuesSheet = workbook.addWorksheet('처리 이슈 목록');
    issuesSheet.columns = [
      { header: '이슈 ID', key: 'id', width: 12 },
      { header: '처리 에이전트', key: 'agentName', width: 15 },
      { header: '프로젝트', key: 'projectName', width: 15 },
      { header: '대분류', key: 'categoryGroup', width: 15 },
      { header: '중분류', key: 'category', width: 15 },
      { header: '제목', key: 'summary', width: 40 },
      { header: '중요도', key: 'severity', width: 10 },
      { header: '성향', key: 'sentiment', width: 10 },
      { header: '상태', key: 'status', width: 12 },
      { header: '열람 시각', key: 'checkedAt', width: 18 },
      { header: '완료 시각', key: 'processedAt', width: 18 },
      { header: '처리 시간', key: 'handleTime', width: 15 }
    ];
    
    issuesSheet.getRow(1).font = { bold: true };
    issuesSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };
    issuesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    
    // 이슈 목록 조회
    const issues = query(`
      SELECT 
        i.id,
        i.summary,
        i.severity,
        i.sentiment,
        i.status,
        i.checkedAt,
        i.processedAt,
        a.name as agentName,
        p.name as projectName,
        cg.name as categoryGroup,
        c.name as category
      FROM ReportItemIssue i
      LEFT JOIN Agent a ON i.processedBy = a.id
      LEFT JOIN Project p ON i.projectId = p.id
      LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
      LEFT JOIN Category c ON i.categoryId = c.id
      WHERE ${whereClause}
      ORDER BY i.processedAt DESC
      LIMIT 1000
    `, params);
    
    issues.forEach(issue => {
      let handleTime = '-';
      if (issue.checkedAt && issue.processedAt) {
        const checked = new Date(issue.checkedAt);
        const processed = new Date(issue.processedAt);
        const diffSeconds = Math.floor((processed.getTime() - checked.getTime()) / 1000);
        if (diffSeconds > 0 && diffSeconds < 86400 * 30) {
          const minutes = Math.floor(diffSeconds / 60);
          const seconds = diffSeconds % 60;
          handleTime = `${minutes}분 ${seconds}초`;
        }
      }
      
      issuesSheet.addRow({
        id: issue.id,
        agentName: issue.agentName || '-',
        projectName: issue.projectName || '-',
        categoryGroup: issue.categoryGroup || '-',
        category: issue.category || '-',
        summary: issue.summary || '-',
        severity: `Sev${issue.severity}`,
        sentiment: issue.sentiment === 'pos' ? '긍정' : issue.sentiment === 'neg' ? '부정' : '중립',
        status: issue.status,
        checkedAt: issue.checkedAt || '-',
        processedAt: issue.processedAt || '-',
        handleTime
      });
    });
    
    // 임시 파일 저장
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const fileName = `agent-stats-${Date.now()}.xlsx`;
    const filePath = path.join(tempDir, fileName);
    
    await workbook.xlsx.writeFile(filePath);
    
    logger.info('Agent stats report generated', { filePath, agentCount: agents.length, issueCount: issues.length });
    
    return filePath;
  } catch (error) {
    logger.error('Failed to generate agent stats report', { error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * PUBG PC / Mobile / 클랜 유입 집계 엑셀 (단일 시트)
 */
/**
 * 유입 집계 시트 한 장 작성 (헤더 스타일 + 데이터 + 합계/전체/비고)
 */
function addGameVolumeWorksheet(workbook, name, rows, { sumRowLabel, firstColHeader }) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header: firstColHeader, key: 'period', width: 18 },
    { header: 'PUBG PC 이슈 수', key: 'pubgPc', width: 18 },
    { header: 'PUBG Mobile 이슈 수', key: 'pubgMobile', width: 22 },
    { header: '클랜 게시글 수', key: 'clanPosts', width: 18 },
    { header: '카드 교환 수', key: 'cardExchangePosts', width: 16 },
    { header: '합계 (PC+모바일+클랜+카드교환)', key: 'rowTotal', width: 26 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F766E' }
  };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  let sumPc = 0;
  let sumMob = 0;
  let sumClan = 0;
  let sumCardEx = 0;
  rows.forEach((r) => {
    const pc = Number(r.pubgPc) || 0;
    const mob = Number(r.pubgMobile) || 0;
    const clan = Number(r.clanPosts) || 0;
    const cardEx = Number(r.cardExchangePosts) || 0;
    sumPc += pc;
    sumMob += mob;
    sumClan += clan;
    sumCardEx += cardEx;
    const rowTotal = pc + mob + clan + cardEx;
    sheet.addRow({
      period: r.period,
      pubgPc: pc,
      pubgMobile: mob,
      clanPosts: clan,
      cardExchangePosts: cardEx,
      rowTotal
    });
  });

  const grand = sumPc + sumMob + sumClan + sumCardEx;
  const totalRow = sheet.addRow({
    period: sumRowLabel,
    pubgPc: sumPc,
    pubgMobile: sumMob,
    clanPosts: sumClan,
    cardExchangePosts: sumCardEx,
    rowTotal: grand
  });
  totalRow.font = { bold: true };

  sheet.addRow({});
  sheet.addRow({
    period: '※ 기준',
    pubgPc: '이슈 createdAt(KST) 유입',
    pubgMobile: '',
    clanPosts: '',
    cardExchangePosts: '관리 화면 카드 교환과 동일',
    rowTotal: ''
  });
}

async function generateGameVolumeExcel({ period, startDate, endDate, projectId }) {
  const { getGameAndClanVolume } = require('./ingestionVolumeAnalytics.service');
  const p = ['daily', 'weekly', 'monthly'].includes(String(period || '')) ? String(period) : 'daily';
  const volOpts = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    projectId: projectId !== undefined && projectId !== '' ? projectId : undefined
  };
  const rows = getGameAndClanVolume({ period: p, ...volOpts });
  const dailyRowsForSheet =
    p === 'daily' ? [] : getGameAndClanVolume({ period: 'daily', ...volOpts });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Wallboard System';
  workbook.created = new Date();

  const label =
    p === 'daily' ? '일별' : p === 'weekly' ? '주간별(ISO 주차)' : '월별';
  const sumRowLabel =
    p === 'daily' ? '일별 합계' : p === 'weekly' ? '주간별 합계' : '월별 합계';

  addGameVolumeWorksheet(workbook, `유입_${label}`, rows, {
    sumRowLabel,
    firstColHeader: '기간'
  });

  if (p !== 'daily' && dailyRowsForSheet.length > 0) {
    addGameVolumeWorksheet(workbook, '일자별_KST', dailyRowsForSheet, {
      sumRowLabel: '일자별 합계',
      firstColHeader: '날짜(KST)'
    });
  }

  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const filePath = path.join(tempDir, `game-volume-${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  logger.info('Game volume excel generated', { filePath, rowCount: rows.length, period: p });
  return filePath;
}

module.exports = {
  generateAgentStatsReport,
  generateGameVolumeExcel
};



