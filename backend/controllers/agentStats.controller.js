const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');

/**
 * 에이전트별 이슈 처리 통계 조회
 * GET /api/agent-stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&agentId=X&projectId=Y
 */
async function getAgentStats(req, res) {
  try {
    const { startDate, endDate, agentId, projectId } = req.query;
    
    // 기본 필터 조건
    let whereConditions = ['1=1'];
    let params = [];
    
    // 날짜 필터
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
    
    // 에이전트 필터
    if (agentId) {
      whereConditions.push('i.processedBy = ?');
      params.push(agentId);
    }
    
    // 프로젝트 필터
    if (projectId) {
      whereConditions.push('i.projectId = ?');
      params.push(parseInt(projectId));
    }
    
    // 처리된 이슈만 (processedAt이 있는 것)
    whereConditions.push('i.processedAt IS NOT NULL');
    whereConditions.push('i.processedBy IS NOT NULL');
    
    const whereClause = whereConditions.join(' AND ');
    
    // 에이전트 목록 조회 (필터 조건에 맞는 에이전트만)
    const agentsQuery = `
      SELECT DISTINCT 
        a.id,
        a.name,
        a.email
      FROM Agent a
      INNER JOIN ReportItemIssue i ON i.processedBy = a.id
      WHERE ${whereClause}
      ORDER BY a.name ASC
    `;
    
    const agents = query(agentsQuery, params);
    
    if (agents.length === 0) {
      return sendSuccess(res, [], 'No agents found for the given criteria');
    }
    
    // 각 에이전트별 통계 계산
    const stats = agents.map(agent => {
      const agentParams = [...params];
      const agentConditions = [...whereConditions];
      
      // 에이전트 필터 추가 (이미 있으면 제외)
      if (!agentId) {
        agentConditions.push('i.processedBy = ?');
        agentParams.push(agent.id);
      }
      
      const agentWhere = agentConditions.join(' AND ');
      
      // 총 처리 건수
      const totalQuery = `
        SELECT COUNT(*) as count
        FROM ReportItemIssue i
        WHERE ${agentWhere}
      `;
      const totalResult = queryOne(totalQuery, agentParams);
      const totalProcessed = totalResult?.count || 0;
      
      // 중요도별 건수
      const severityQuery = `
        SELECT 
          severity,
          COUNT(*) as count
        FROM ReportItemIssue i
        WHERE ${agentWhere}
        GROUP BY severity
      `;
      const severityResults = query(severityQuery, agentParams);
      const severityBreakdown = {
        sev1: 0,
        sev2: 0,
        sev3: 0
      };
      severityResults.forEach(r => {
        if (r.severity === 1) severityBreakdown.sev1 = r.count;
        if (r.severity === 2) severityBreakdown.sev2 = r.count;
        if (r.severity === 3) severityBreakdown.sev3 = r.count;
      });
      
      // 성향별 건수
      const sentimentQuery = `
        SELECT 
          sentiment,
          COUNT(*) as count
        FROM ReportItemIssue i
        WHERE ${agentWhere}
        GROUP BY sentiment
      `;
      const sentimentResults = query(sentimentQuery, agentParams);
      const sentimentBreakdown = {
        pos: 0,
        neg: 0,
        neu: 0
      };
      sentimentResults.forEach(r => {
        if (r.sentiment === 'pos') sentimentBreakdown.pos = r.count;
        if (r.sentiment === 'neg') sentimentBreakdown.neg = r.count;
        if (r.sentiment === 'neu') sentimentBreakdown.neu = r.count;
      });
      
      // 상태별 건수
      const statusQuery = `
        SELECT 
          status,
          COUNT(*) as count
        FROM ReportItemIssue i
        WHERE ${agentWhere}
        GROUP BY status
      `;
      const statusResults = query(statusQuery, agentParams);
      const statusBreakdown = {
        resolved: 0,
        inProgress: 0,
        triaged: 0,
        open: 0
      };
      statusResults.forEach(r => {
        if (r.status === 'RESOLVED' || r.status === 'VERIFIED') statusBreakdown.resolved += r.count;
        if (r.status === 'IN_PROGRESS' || r.status === 'WAITING') statusBreakdown.inProgress += r.count;
        if (r.status === 'TRIAGED') statusBreakdown.triaged += r.count;
        if (r.status === 'OPEN') statusBreakdown.open += r.count;
      });
      
      // 처리 시간 통계 (checkedAt부터 processedAt까지의 시간)
      const timeQuery = `
        SELECT 
          (julianday(i.processedAt) - julianday(i.checkedAt)) * 86400 as handleTime
        FROM ReportItemIssue i
        WHERE ${agentWhere}
          AND i.checkedAt IS NOT NULL
          AND i.processedAt IS NOT NULL
          AND i.processedAt > i.checkedAt
        ORDER BY handleTime ASC
      `;
      const timeResults = query(timeQuery, agentParams);
      
      let avgHandleTime = null;
      let medianHandleTime = null;
      let fastestHandleTime = null;
      let slowestHandleTime = null;
      
      if (timeResults.length > 0) {
        const times = timeResults.map(r => r.handleTime).filter(t => t > 0 && t < 86400 * 30); // 30일 이내만 유효
        
        if (times.length > 0) {
          avgHandleTime = Math.round(times.reduce((sum, t) => sum + t, 0) / times.length);
          fastestHandleTime = Math.round(Math.min(...times));
          slowestHandleTime = Math.round(Math.max(...times));
          
          // 중앙값 계산
          const sorted = [...times].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          medianHandleTime = sorted.length % 2 === 0
            ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
            : Math.round(sorted[mid]);
        }
      }
      
      // 카테고리별 건수
      const categoryQuery = `
        SELECT 
          cg.name as categoryGroup,
          c.name as category,
          COUNT(*) as count
        FROM ReportItemIssue i
        LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
        LEFT JOIN Category c ON i.categoryId = c.id
        WHERE ${agentWhere}
        GROUP BY i.categoryGroupId, i.categoryId
        ORDER BY count DESC
        LIMIT 10
      `;
      const categoryBreakdown = query(categoryQuery, agentParams).map(r => ({
        categoryGroup: r.categoryGroup || '미분류',
        category: r.category || '미분류',
        count: r.count
      }));
      
      // 프로젝트별 건수
      const projectQuery = `
        SELECT 
          p.name as projectName,
          COUNT(*) as count
        FROM ReportItemIssue i
        LEFT JOIN Project p ON i.projectId = p.id
        WHERE ${agentWhere}
        GROUP BY i.projectId
        ORDER BY count DESC
      `;
      const projectBreakdown = query(projectQuery, agentParams).map(r => ({
        projectName: r.projectName || '미지정',
        count: r.count
      }));
      
      // 일별 통계
      const dailyQuery = `
        SELECT 
          DATE(i.processedAt, '+9 hours') as date,
          COUNT(*) as count,
          AVG((julianday(i.processedAt) - julianday(i.checkedAt)) * 86400) as avgTime
        FROM ReportItemIssue i
        WHERE ${agentWhere}
          AND i.checkedAt IS NOT NULL
        GROUP BY DATE(i.processedAt, '+9 hours')
        ORDER BY date ASC
      `;
      const dailyStats = query(dailyQuery, agentParams).map(r => ({
        date: r.date,
        count: r.count,
        avgTime: r.avgTime ? Math.round(r.avgTime) : null
      }));
      
      return {
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        totalProcessed,
        severityBreakdown,
        sentimentBreakdown,
        statusBreakdown,
        avgHandleTime,
        medianHandleTime,
        fastestHandleTime,
        slowestHandleTime,
        categoryBreakdown,
        projectBreakdown,
        dailyStats
      };
    });
    
    logger.info('Agent stats retrieved', { 
      agentCount: stats.length, 
      startDate, 
      endDate, 
      agentId, 
      projectId 
    });
    
    sendSuccess(res, stats, 'Agent statistics retrieved successfully');
  } catch (error) {
    logger.error('Failed to get agent stats', { error: error.message, stack: error.stack });
    sendError(res, 'Failed to get agent stats', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 에이전트 통계를 엑셀로 내보내기
 * GET /api/agent-stats/export?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&agentId=X&projectId=Y
 */
async function exportStatsToExcel(req, res) {
  try {
    const { startDate, endDate, agentId, projectId } = req.query;
    
    const { generateAgentStatsReport } = require('../services/agentStatsReport.service');
    
    const filePath = await generateAgentStatsReport({
      startDate,
      endDate,
      agentId,
      projectId
    });
    
    logger.info('Agent stats report generated', { filePath });
    
    // 파일 다운로드
    const fileName = `agent-stats-${startDate || 'all'}-${endDate || 'all'}.xlsx`;
    res.download(filePath, fileName, (err) => {
      if (err) {
        logger.error('Failed to download file', { error: err.message });
      }
      // 파일 삭제 (다운로드 후)
      const fs = require('fs');
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          logger.warn('Failed to delete temp file', { path: filePath, error: unlinkErr.message });
        }
      });
    });
  } catch (error) {
    logger.error('Failed to export agent stats', { error: error.message, stack: error.stack });
    sendError(res, 'Failed to export agent stats', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * PUBG PC/Mobile·클랜·카드 교환 유입 이슈 집계 (일/주/월)
 * GET /api/agent-stats/game-volume?period=daily|weekly|monthly&startDate&endDate&projectId
 */
async function getGameVolume(req, res) {
  try {
    const { period = 'daily', startDate, endDate, projectId } = req.query;
    const p = ['daily', 'weekly', 'monthly'].includes(String(period)) ? String(period) : 'daily';
    const { getGameAndClanVolume } = require('../services/ingestionVolumeAnalytics.service');
    const volOpts = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      projectId: projectId !== undefined && projectId !== '' ? projectId : undefined
    };
    const rows = getGameAndClanVolume({ period: p, ...volOpts });
    const dailyRows =
      p === 'daily'
        ? rows
        : getGameAndClanVolume({ period: 'daily', ...volOpts });
    sendSuccess(res, { period: p, rows, dailyRows }, 'Game/clan volume retrieved');
  } catch (error) {
    logger.error('Failed to get game volume', { error: error.message, stack: error.stack });
    sendError(res, 'Failed to get game volume', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * GET /api/agent-stats/game-volume/export?period=...&startDate&endDate&projectId
 */
async function exportGameVolumeExcel(req, res) {
  try {
    const { period = 'daily', startDate, endDate, projectId } = req.query;
    const { generateGameVolumeExcel } = require('../services/agentStatsReport.service');
    const filePath = await generateGameVolumeExcel({
      period,
      startDate,
      endDate,
      projectId
    });
    const p = ['daily', 'weekly', 'monthly'].includes(String(period)) ? String(period) : 'daily';
    const fileName = `game-clan-volume-${p}-${startDate || 'all'}-${endDate || 'all'}.xlsx`;
    res.download(filePath, fileName, (err) => {
      if (err) {
        logger.error('Failed to download game volume file', { error: err.message });
      }
      const fs = require('fs');
      fs.unlink(filePath, () => {});
    });
  } catch (error) {
    logger.error('Failed to export game volume', { error: error.message, stack: error.stack });
    sendError(res, 'Failed to export game volume', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  getAgentStats,
  exportStatsToExcel,
  getGameVolume,
  exportGameVolumeExcel
};

