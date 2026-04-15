const { query } = require('../libs/db');
const logger = require('../utils/logger');

function normalizeProjectId(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') {
    return undefined;
  }
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    throw new Error('Invalid projectId');
  }
  return id;
}

function normalizeDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }
  return date;
}

function formatDay(dateValue) {
  if (!dateValue) return '';
  try {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return String(dateValue).split('T')[0] || '';
    }
    return date.toISOString().split('T')[0];
  } catch (error) {
    return String(dateValue).split('T')[0] || '';
  }
}

/**
 * 메트릭 개요 데이터 조회
 * 
 * Prisma 스키마 기준:
 * - ReportItemIssue 모델 사용
 * - projectId: Int? (선택적)
 * - createdAt: DateTime (날짜 필터링용)
 * - assignedAgent: Agent? 관계 (IssueAssignedAgent)
 * - status: String (기본값: "OPEN")
 * - category: String? (선택적)
 * - severity: Int? (선택적)
 * - date: String (이슈 발생 일자)
 * 
 * @param {Object} params - 쿼리 파라미터
 * @param {string|number} params.projectId - 프로젝트 ID
 * @param {string} params.from - 시작 날짜 (ISO 형식)
 * @param {string} params.to - 종료 날짜 (ISO 형식)
 * @returns {Promise<Object>} 메트릭 데이터
 */
async function getOverviewMetrics({ projectId, from, to } = {}) {
  try {
    // WHERE 조건 구성
    const where = {};
    
    // projectId 필터링 (스키마: projectId Int?)
    if (projectId !== undefined && projectId !== null && projectId !== '') {
      const normalizedProjectId = normalizeProjectId(projectId);
      if (normalizedProjectId !== undefined) {
        where.projectId = normalizedProjectId;
      }
    }

    // 날짜 범위 필터링 (스키마: createdAt DateTime)
    const fromDate = normalizeDate(from);
    const toDate = normalizeDate(to);
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) {
        where.createdAt.gte = fromDate;
      }
      if (toDate) {
        // 종료 날짜는 하루 끝까지 포함
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        where.createdAt.lte = endOfDay;
      }
    }

    logger.debug('Fetching metrics overview', { where });

    // SQL 쿼리 실행
    const { query } = require('../libs/db');
    
    let sql = `SELECT i.*, a.id as assignedAgent_id, a.name as assignedAgent_name 
               FROM ReportItemIssue i
               LEFT JOIN Agent a ON i.assignedAgentId = a.id
               WHERE 1=1`;
    const params = [];
    
    if (projectId) {
      sql += ' AND i.projectId = ?';
      params.push(Number(projectId));
    }
    
    if (from) {
      const startOfDay = new Date(from);
      startOfDay.setHours(0, 0, 0, 0);
      sql += ' AND i.createdAt >= ?';
      params.push(startOfDay.toISOString());
    }
    
    if (to) {
      const endOfDay = new Date(to);
      endOfDay.setHours(23, 59, 59, 999);
      sql += ' AND i.createdAt <= ?';
      params.push(endOfDay.toISOString());
    }
    
    sql += ' ORDER BY i.createdAt ASC';
    
    const issues = query(sql, params).map(issue => ({
      ...issue,
      assignedAgent: issue.assignedAgent_id ? {
        id: issue.assignedAgent_id,
        name: issue.assignedAgent_name
      } : null
    }));

    logger.debug(`Found ${issues.length} issues for metrics overview`);

    // 메트릭 집계
    const issuesByStatus = {};
    const issuesByCategory = {};
    const issuesBySeverity = {};
    const issuesPerDayMap = {};
    const issuesHandledByAgent = {};

    issues.forEach((issue) => {
      // 상태별 집계 (스키마: status String, 기본값 "OPEN")
      const status = (issue.status || 'OPEN').toUpperCase();
      issuesByStatus[status] = (issuesByStatus[status] || 0) + 1;

      // 카테고리별 집계 (스키마: category String?)
      const category = issue.category || '기타';
      issuesByCategory[category] = (issuesByCategory[category] || 0) + 1;

      // 심각도별 집계 (스키마: severity Int?)
      const severityLabel = issue.severity ? `Sev${issue.severity}` : 'Unknown';
      issuesBySeverity[severityLabel] = (issuesBySeverity[severityLabel] || 0) + 1;

      // 일자별 집계 (스키마: date String 또는 createdAt DateTime)
      const dayKey = issue.date || formatDay(issue.createdAt);
      if (dayKey) {
        issuesPerDayMap[dayKey] = (issuesPerDayMap[dayKey] || 0) + 1;
      }

      // 에이전트별 집계 (스키마: assignedAgent Agent? 관계)
      const agentName = issue.assignedAgent?.name || 'Unassigned';
      issuesHandledByAgent[agentName] = (issuesHandledByAgent[agentName] || 0) + 1;
    });

    // 일자별 데이터 정렬
    const issuesPerDay = Object.entries(issuesPerDayMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
      });

    return {
      totalIssues: issues.length,
      issuesByStatus,
      issuesByCategory,
      issuesBySeverity,
      issuesPerDay,
      issuesHandledByAgent
    };
  } catch (error) {
    logger.error('Error in getOverviewMetrics', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      meta: error.meta,
      projectId,
      from,
      to
    });
    logger.error('Failed to get overview metrics', {
      error: error.message,
      stack: error.stack,
      projectId,
      from,
      to
    });
    throw error;
  }
}

module.exports = {
  getOverviewMetrics
};



