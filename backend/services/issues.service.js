// Issues 서비스

const { query, queryOne, execute, safeQuery } = require('../libs/db');
const { categorizeIssue } = require('../utils/keyword-categorizer');
const logger = require('../utils/logger');
const { resolveAgentDisplayName } = require('../utils/agentDisplayName');
const {
  getClanDedicatedMonitoredBoardIds,
  getClanWorkerTargetMonitoredBoardIds
} = require('../utils/clanMonitoredBoardIds');
const issueCommentWatchService = require('./issueCommentWatch.service');
const crawlerGames = require('./crawlerGames.service');

const ISSUE_STATUSES = ['OPEN', 'TRIAGED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'VERIFIED', 'CLOSED'];

function normalizePostImagePaths(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const cleaned = raw.filter((x) => typeof x === 'string' && x.trim().length > 0);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // DB에 JSON 문자열로 저장된 경우가 대부분이지만,
  // 일부 경로는 이중 JSON 인코딩("["..."]") 형태로 들어올 수 있어 2회까지 파싱 시도한다.
  let parsed = null;
  try {
    parsed = JSON.parse(s);
  } catch {
    parsed = null;
  }
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // ignore
    }
  }
  if (Array.isArray(parsed)) {
    const cleaned = parsed.filter((x) => typeof x === 'string' && x.trim().length > 0);
    return cleaned.length > 0 ? cleaned : null;
  }
  return null;
}

function normalizeProjectIdInput(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') {
    return undefined;
  }
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    throw new Error('Invalid project id');
  }
  return id;
}

function normalizeStatus(status = 'OPEN') {
  if (!status) return 'OPEN';
  const normalized = String(status).toUpperCase();
  return ISSUE_STATUSES.includes(normalized) ? normalized : 'OPEN';
}

async function findIssueById(issueId, extras = {}) {
  if (!issueId) {
    throw new Error('Issue ID is required');
  }
  const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
  if (!issue) return null;

  // postImagePaths: DB(TEXT) -> API(JSON array)로 정규화 (FE에서 다중 이미지 표시용)
  if (issue.postImagePaths !== undefined) {
    issue.postImagePaths = normalizePostImagePaths(issue.postImagePaths);
  }
  
  // SQLite에서 불리언 필드 변환 (0/1 -> true/false)
  if (issue.hasImages !== undefined) {
    issue.hasImages = Boolean(issue.hasImages);
  }
  if (issue.requiresLogin !== undefined) {
    issue.requiresLogin = Boolean(issue.requiresLogin);
  }
  if (issue.isHotTopic !== undefined) {
    issue.isHotTopic = Boolean(issue.isHotTopic);
  }
  if (issue.excludedFromReport !== undefined) {
    issue.excludedFromReport = Boolean(issue.excludedFromReport);
  }
  
  // 관계 데이터 로드
  if (extras.include) {
    if (extras.include.categoryGroup) {
      if (issue.categoryGroupId) {
        issue.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [issue.categoryGroupId]);
      }
    }
    if (extras.include.category) {
      if (issue.categoryId) {
        issue.category = queryOne('SELECT * FROM Category WHERE id = ?', [issue.categoryId]);
      }
    }
    if (extras.include.assignedAgent) {
      if (issue.assignedAgentId) {
        const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [issue.assignedAgentId]);
        issue.assignedAgent = ag
          ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
          : null;
      }
    }
  }
  
  return issue;
}

async function getIssueById(issueId) {
  return findIssueById(issueId);
}

/**
 * 단일 이슈 상세 (목록 API와 유사한 형태 + commentWatch 메타)
 * @param {string} issueId
 * @param {number|undefined|null} projectId
 * @returns {Promise<object|null>}
 */
async function getIssueDetailForClient(issueId, projectId) {
  const issue = await findIssueById(issueId, {
    include: { categoryGroup: true, category: true, assignedAgent: true }
  });
  if (!issue) return null;
  if (projectId !== undefined && projectId !== null && issue.projectId != null && issue.projectId !== projectId) {
    return null;
  }

  const commentCountRow = queryOne('SELECT COUNT(*) as c FROM IssueComment WHERE issueId = ?', [issueId]);
  const internalCommentCount = commentCountRow?.c ?? 0;
  const commentsCount = internalCommentCount || issue.commentCount || 0;

  const contentToCategorize = `${issue.summary || ''} ${issue.detail || ''}`;
  const categoriesRaw = categorizeIssue(contentToCategorize);
  const categories = Array.isArray(categoriesRaw) && categoriesRaw.length > 0 ? categoriesRaw : ['기타'];
  const primaryCategory = categories[0] || '기타';

  const monitoredBoard = issue.monitoredBoardId
    ? queryOne('SELECT id, cafeGame, name FROM MonitoredBoard WHERE id = ?', [issue.monitoredBoardId])
    : null;

  const watchRow = issueCommentWatchService.getWatchByIssueId(issueId);

  return {
    ...issue,
    status: normalizeStatus(issue.status),
    categories,
    primaryCategory,
    monitoredBoard,
    commentsCount,
    scrapedComments: issue.scrapedComments || null,
    hasImages: Boolean(issue.hasImages),
    requiresLogin: Boolean(issue.requiresLogin),
    isHotTopic: Boolean(issue.isHotTopic),
    excludedFromReport: Boolean(issue.excludedFromReport),
    commentWatch: watchRow ? issueCommentWatchService.rowToWatchDto(watchRow) : null
  };
}

async function ensureIssueInProject(issueId, projectId, extras = {}) {
  const issue = await findIssueById(issueId, extras);
  if (!issue) {
    throw new Error('Issue not found');
  }
  if (projectId && issue.projectId && issue.projectId !== projectId) {
    throw new Error('Issue does not belong to the selected project');
  }
  return issue;
}

async function ensureAgentExists(agentId) {
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  const agent = queryOne('SELECT * FROM Agent WHERE id = ?', [agentId]);
  if (!agent) {
    throw new Error('Assigned agent not found');
  }
  return agent;
}

async function findAgentIdForUser(userId) {
  if (!userId) return null;
  const numericUserId = Number(userId);
  if (Number.isNaN(numericUserId)) return null;
  const agent = queryOne('SELECT * FROM Agent WHERE userId = ?', [numericUserId]);
  return agent ? agent.id : null;
}

/**
 * 모든 이슈 조회 (카테고리 자동 분류 포함)
 * @param {Object} options - 조회 옵션
 * @param {string} options.agentId - 특정 에이전트 필터 (선택)
 * @param {string} options.startDate - 시작 날짜 (YYYY-MM-DD)
 * @param {string} options.endDate - 종료 날짜 (YYYY-MM-DD)
 * @param {number} options.severity - 심각도 필터 (1, 2, 3)
 * @param {string} options.status - 상태 필터
 * @param {string} options.category - 카테고리 필터
 * @param {number} options.limit - 최대 개수
 * @param {number} options.offset - 오프셋
 * @returns {Promise<Object>} 이슈 목록 및 통계
 */
async function getAllIssues(options = {}) {
  const {
    agentId,
    startDate,
    endDate,
    severity,
    status,
    category,
    projectId,
    search,
    limit, // limit이 undefined이면 무제한 (LIMIT 절 제거)
    offset = 0
  } = options;
  
  logger.debug('getAllIssues service called', { 
    startDate, 
    endDate, 
    projectId,
    hasSearch: !!search,
    limit,
    offset
  });
  
  const where = {};
  // excludedFromReport = 1인 항목은 이슈 목록에서 제외
  
  // 검색 필터 (search 파라미터가 있을 경우)
  if (search && search.trim().length > 0) {
    const searchTerm = search.trim();
    const searchConditions = [];
    
    // SQLite는 case-insensitive 모드를 지원하지 않으므로 contains만 사용
    // 대소문자 구분 없이 검색하려면 검색어를 소문자로 변환하여 비교 (Prisma는 자동으로 처리)
    
    // 1. summary (제목) 검색
    searchConditions.push({
      summary: {
        contains: searchTerm
      }
    });
    
    // 2. detail (본문) 검색
    searchConditions.push({
      detail: {
        contains: searchTerm
      }
    });
    
    // 3. id (ID로 직접 검색)
    searchConditions.push({
      id: {
        equals: searchTerm
      }
    });
    
    // 4. category.name (카테고리 이름) 검색
    searchConditions.push({
      category: {
        name: {
          contains: searchTerm
        }
      }
    });
    
    // 5. assignedAgent.name (담당자 이름) 검색
    searchConditions.push({
      assignedAgent: {
        name: {
          contains: searchTerm
        }
      }
    });
    
    // 검색 조건을 OR로 묶어서 기존 where 조건과 AND로 결합
    // 검색은 항상 기존 필터와 AND로 결합되어야 함
    const searchOrCondition = { OR: searchConditions };
    
    // 검색 조건을 AND 배열에 추가 (나중에 다른 필터와 결합)
    if (!where.AND) {
      where.AND = [];
    }
    where.AND.push(searchOrCondition);
  }
  
  // 에이전트 필터 (크롤링된 이슈는 report가 없을 수 있으므로 OR 조건 사용)
  if (agentId) {
    const agentOrCondition = [
      { report: { agentId: agentId } },
      { report: null } // 크롤링된 이슈도 포함
    ];
    
    // 기존 조건과 결합
    if (where.AND) {
      where.AND.push({ OR: agentOrCondition });
    } else if (where.OR) {
      // 기존 OR 조건이 있으면 AND로 결합
      where.AND = [
        { OR: where.OR },
        { OR: agentOrCondition }
      ];
      delete where.OR;
    } else {
      where.OR = agentOrCondition;
    }
  }

  // projectId 필터: 지정된 projectId이거나 null인 이슈도 포함 (크롤링된 이슈는 projectId가 null일 수 있음)
  // projectId가 명시적으로 전달되지 않으면(undefined) 모든 이슈 조회
  if (projectId !== undefined && projectId !== null) {
    // 기존 OR 조건이 있으면 병합, 없으면 새로 생성
    if (where.OR) {
      // 기존 OR 조건과 projectId 조건을 AND로 결합
      where.AND = [
        { OR: where.OR },
        {
          OR: [
            { projectId: projectId },
            { projectId: null }
          ]
        }
      ];
      delete where.OR;
    } else {
      where.OR = [
        { projectId: projectId },
        { projectId: null } // 크롤링된 이슈 등 projectId가 없는 이슈도 포함
      ];
    }
  }
  // projectId가 undefined이면 필터링하지 않음 (모든 이슈 조회)
  
  // 날짜 필터 (크롤링된 이슈는 date 필드가 다를 수 있으므로 주의)
  if (startDate || endDate) {
    const dateCondition = {};
    if (startDate) {
      dateCondition.gte = startDate;
    }
    if (endDate) {
      dateCondition.lte = endDate;
    }
    
    // 기존 조건과 결합
    if (where.AND) {
      where.AND.push({ date: dateCondition });
    } else {
      where.date = dateCondition;
    }
  }
  
  // 심각도 필터
  if (severity) {
    if (where.AND) {
      where.AND.push({ severity });
    } else {
      where.severity = severity;
    }
  }
  
  // 상태 필터
  if (status) {
    if (where.AND) {
      where.AND.push({ status });
    } else {
      where.status = status;
    }
  }
  
  try {
    // SQL 쿼리 구성
    // 클랜 관련 게시글은 클랜 게시글 페이지에만 표시되도록 일반 이슈 목록에서 제외
    // 성능 최적화: 댓글 개수를 서브쿼리로 조인하여 N+1 문제 해결
    let sql = `SELECT i.*, r.agentId as report_agentId, 
               a.id as assignedAgent_id, a.name as assignedAgent_name, a.email as assignedAgent_email,
               cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
               c.id as category_id, c.name as category_name,
               mb.id as monitoredBoard_id, mb.cafeGame as monitoredBoard_cafeGame, mb.name as monitoredBoard_name,
               COALESCE(comment_counts.comment_count, 0) as comment_count
               FROM ReportItemIssue i
               LEFT JOIN Report r ON i.reportId = r.id
               LEFT JOIN Agent a ON i.assignedAgentId = a.id
               LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
               LEFT JOIN Category c ON i.categoryId = c.id
               LEFT JOIN MonitoredBoard mb ON i.monitoredBoardId = mb.id
               LEFT JOIN (
                 SELECT issueId, COUNT(*) as comment_count 
                 FROM IssueComment 
                 GROUP BY issueId
               ) comment_counts ON i.id = comment_counts.issueId
               WHERE 1=1
                 -- excludedFromReport = 1인 항목 제외 (이슈에서 안보이게 처리)
                 AND (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)
                 -- 이슈 제외 게시글 필터링
                 -- PUBG PC: 제목에 [Steam] 붙은 게시글 (시작 또는 포함)
                 -- PUBG Mobile: 제목에 [클랜] 붙은 게시글
                 -- 클랜/방송/디스코드 게시판의 모든 게시글 (게시판명 또는 제목 패턴 기준)
                 -- 클랜 모집 관련 게시글 (제목/내용에 클랜 모집 키워드가 있는 경우)
                 AND NOT (
                   -- 제목 말머리 패턴
                   i.summary LIKE '[Steam]%'
                   OR i.summary LIKE '%[Steam]%'
                   OR i.summary LIKE '[클랜]%'
                   OR i.summary LIKE '%[클랜]%'
                   -- 클랜/방송/디스코드 말머리 패턴
                   OR i.summary LIKE '🏰┃클랜/방송/디스코드%'
                   OR i.summary LIKE '%🏰┃클랜/방송/디스코드%'
                   OR i.summary LIKE '%클랜/방송/디스코드%'
                   -- 게시판명 기준 (LEFT JOIN이므로 NULL 체크)
                   OR (mb.name IS NOT NULL AND (
                     mb.name = '클랜/방송/디스코드'
                     OR mb.name = '클랜 홍보'
                     OR mb.name LIKE '%클랜/방송/디스코드%'
                     OR mb.name LIKE '%클랜 홍보%'
                     OR mb.name LIKE '%클랜홍보%'
                   ))
                   -- 클랜 모집 관련 키워드 (제목 또는 내용에 포함된 경우 모두 제외)
                   OR i.summary LIKE '%클랜%모집%'
                   OR i.summary LIKE '%클랜모집%'
                   OR i.summary LIKE '%모집%클랜%'
                   OR i.summary LIKE '%클랜원%모집%'
                   OR i.summary LIKE '%클랜원모집%'
                   OR i.summary LIKE '%클원%모집%'
                   OR i.summary LIKE '%클원모집%'
                   OR i.summary LIKE '%클랜%가입%'
                   OR i.summary LIKE '%클랜가입%'
                   OR i.summary LIKE '%가입%클랜%'
                   OR i.detail LIKE '%클랜%모집%'
                   OR i.detail LIKE '%클랜모집%'
                   OR i.detail LIKE '%모집%클랜%'
                   OR i.detail LIKE '%클랜원%모집%'
                   OR i.detail LIKE '%클랜원모집%'
                   OR i.detail LIKE '%클원%모집%'
                   OR i.detail LIKE '%클원모집%'
                   OR i.detail LIKE '%클랜%가입%'
                   OR i.detail LIKE '%클랜가입%'
                   OR i.detail LIKE '%가입%클랜%'
                   -- [kakao] 또는 [KaKao] 등 대소문자 변형으로 시작하고 클랜 관련 키워드가 있는 경우
                   OR ((i.summary LIKE '[kakao]%' OR i.summary LIKE '[Kakao]%' OR i.summary LIKE '[KaKao]%' OR i.summary LIKE 'KaKao%') AND (
                     i.summary LIKE '%클랜%'
                     OR i.detail LIKE '%클랜%'
                   ))
                   -- 디스코드 서버 관련 게시글
                   OR i.summary LIKE '%디코서버%'
                   OR i.summary LIKE '%디스코드 서버%'
                   OR i.summary LIKE '%디스코드서버%'
                   OR i.detail LIKE '%디코서버%'
                   OR i.detail LIKE '%디스코드 서버%'
                   OR i.detail LIKE '%디스코드서버%'
                 )`;
    const params = [];
    
    // 필터 조건 추가
    if (projectId !== undefined && projectId !== null) {
      // 특정 프로젝트 조회 시 해당 프로젝트만 조회 (projectId=null 제외)
      // 전체 조회 시에만 모든 프로젝트 포함
      // projectId가 유효한지 확인 (해당 프로젝트에 이슈가 있는지 체크)
      const projectIssueCount = queryOne(
        'SELECT COUNT(*) as count FROM ReportItemIssue WHERE projectId = ?',
        [projectId]
      );
      
      // 해당 프로젝트에 이슈가 있으면 필터 적용
      if (projectIssueCount && projectIssueCount.count > 0) {
        sql += ' AND i.projectId = ?';
        params.push(projectId);
        logger.debug('Filtering by projectId', { projectId, issueCount: projectIssueCount.count });
      } else {
        // 해당 프로젝트에 이슈가 없으면 projectId 필터 무시하고 모든 이슈 반환
        logger.warn('Project has no issues, ignoring projectId filter and returning all issues', { projectId });
      }
    } else {
      logger.debug('No projectId filter, returning all issues');
    }
    
    if (agentId) {
      sql += ' AND (r.agentId = ? OR r.agentId IS NULL)';
      params.push(agentId);
    }
    
    // 날짜 필터 (한국 시간대 기준)
    // date 필드와 createdAt 필드 둘 다 확인하여, 둘 중 하나라도 해당 날짜 범위에 포함되면 포함
    // 1월 5일 00:00 (KST) 이후 수집된 이슈는 createdAt 기준으로도 포함되도록 처리
    if (startDate) {
      // 시작일: date 필드 또는 createdAt 필드 중 하나라도 해당 날짜 이후이면 포함
      // date 필드는 한국 시간 기준 YYYY-MM-DD 형식
      // createdAt은 UTC 형식이므로, 한국 시간 기준으로 변환하여 비교
      // SQLite에서 날짜 비교: DATE(i.createdAt, '+9 hours') >= startDate
      sql += ' AND (i.date >= ? OR DATE(i.createdAt, \'+9 hours\') >= ?)';
      params.push(startDate, startDate);
      logger.debug('날짜 필터 적용 - 시작일', { startDate, sql: sql.substring(sql.length - 80) });
    }
    
    if (endDate) {
      // 종료일: date 필드 또는 createdAt 필드 중 하나라도 해당 날짜 이전이면 포함
      sql += ' AND (i.date <= ? OR DATE(i.createdAt, \'+9 hours\') <= ?)';
      params.push(endDate, endDate);
      logger.debug('날짜 필터 적용 - 종료일', { endDate, sql: sql.substring(sql.length - 80) });
    }
    
    if (severity) {
      sql += ' AND i.severity = ?';
      params.push(severity);
    }
    
    if (status) {
      sql += ' AND i.status = ?';
      params.push(status);
    }
    
    if (search && search.trim().length > 0) {
      const searchTerm = `%${search.trim()}%`;
      sql += ' AND (i.summary LIKE ? OR i.detail LIKE ? OR i.id = ?)';
      params.push(searchTerm, searchTerm, search.trim());
    }
    
    sql += ' ORDER BY i.createdAt DESC';
    // limit이 지정된 경우에만 LIMIT 절 추가
    if (limit !== undefined && limit !== null) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    // OFFSET은 limit이 있을 때만 의미가 있지만, offset만 있어도 추가
    if (offset > 0) {
      sql += ' OFFSET ?';
      params.push(offset);
    }
    
    const issues = query(sql, params);
    
    // 댓글 개수는 이미 쿼리에 포함되어 있으므로 별도 조회 불필요
    // comment_count 필드가 이미 결과에 포함됨
    
    logger.info('Issues retrieved from database', { 
      count: issues.length, 
      limit, 
      offset,
      projectId,
      projectIdType: typeof projectId,
      hasAgentId: !!agentId,
      startDate,
      endDate,
      sql: sql.substring(0, 300), // SQL 쿼리 일부 로그
      params: params.slice(0, 10) // 파라미터 일부 로그
    });
    
    // 카테고리 분류 및 필터링
    const categorizedIssues = issues.map(issue => {
      const contentToCategorize = `${issue.summary || ''} ${issue.detail || ''}`;
      const categoriesRaw = categorizeIssue(contentToCategorize);
      const categories = Array.isArray(categoriesRaw) && categoriesRaw.length > 0 ? categoriesRaw : ['기타'];
      const primaryCategory = categories[0] || '기타';
      const { assignedAgent_email, ...issueRow } = issue;
      const assignedDisplayName = resolveAgentDisplayName(
        issue.assignedAgent_name,
        assignedAgent_email
      );
      return {
        ...issueRow,
        status: normalizeStatus(issue.status),
        categories,
        primaryCategory,
        agentId: issue.report_agentId,
        assignedAgentName: assignedDisplayName || null,
        assignedAgent: issue.assignedAgent_id
          ? { id: issue.assignedAgent_id, name: assignedDisplayName }
          : null,
        categoryGroup: issue.categoryGroup_id ? { id: issue.categoryGroup_id, name: issue.categoryGroup_name, code: issue.categoryGroup_code, color: issue.categoryGroup_color } : null,
        category: issue.category_id ? { id: issue.category_id, name: issue.category_name } : null,
        monitoredBoard: issue.monitoredBoard_id ? { id: issue.monitoredBoard_id, cafeGame: issue.monitoredBoard_cafeGame, name: issue.monitoredBoard_name } : null,
        commentsCount: issue.comment_count || issue.commentCount || 0,
        scrapedComments: issue.scrapedComments || null,
        isHotTopic: Boolean(issue.isHotTopic),
        hasImages: Boolean(issue.hasImages),
        requiresLogin: Boolean(issue.requiresLogin),
        postImagePaths: normalizePostImagePaths(issue.postImagePaths)
      };
    }).filter(issue => {
      if (category && category !== 'all') {
        return issue.categories.includes(category) || issue.primaryCategory === category;
      }
      return true;
    });
    
    // 전체 개수 조회
    let countSql = 'SELECT COUNT(*) as count FROM ReportItemIssue i LEFT JOIN Report r ON i.reportId = r.id WHERE 1=1';
    const countParams = [];
    
    if (projectId !== undefined && projectId !== null) {
      countSql += ' AND (i.projectId = ? OR i.projectId IS NULL)';
      countParams.push(projectId);
    }
    if (agentId) {
      countSql += ' AND (r.agentId = ? OR r.agentId IS NULL)';
      countParams.push(agentId);
    }
    // 날짜 필터 (한국 시간대 기준)
    // date 필드는 한국 시간 기준 YYYY-MM-DD 형식으로 저장되어 있으므로, 직접 비교
    if (startDate) {
      countSql += ' AND i.date >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      countSql += ' AND i.date <= ?';
      countParams.push(endDate);
    }
    if (severity) {
      countSql += ' AND i.severity = ?';
      countParams.push(severity);
    }
    if (status) {
      countSql += ' AND i.status = ?';
      countParams.push(status);
    }
    if (search && search.trim().length > 0) {
      const searchTerm = `%${search.trim()}%`;
      countSql += ' AND (i.summary LIKE ? OR i.detail LIKE ? OR i.id = ?)';
      countParams.push(searchTerm, searchTerm, search.trim());
    }
    
    const totalResult = queryOne(countSql, countParams);
    const total = totalResult?.count || 0;
    
    return {
      issues: categorizedIssues,
      total,
      limit,
      offset
    };
  } catch (error) {
    logger.error('Failed to retrieve issues', { error: error.message, stack: error.stack, where, limit, offset });
    // 에러 발생 시에도 빈 배열 반환 (기존 동작 유지)
    return { issues: [], total: 0, limit, offset };
  }
}

function getKstTodayYmd() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getGameIssueCounts(options = {}) {
  const { projectId, startDate, endDate } = options;
  const start = startDate || getKstTodayYmd();
  const end = endDate || start;

  const baseWhere = `
    WHERE 1=1
      AND (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)
      AND NOT (
        i.summary LIKE '[Steam]%'
        OR i.summary LIKE '%[Steam]%'
        OR i.summary LIKE '[클랜]%'
        OR i.summary LIKE '%[클랜]%'
        OR i.summary LIKE '🏰┃클랜/방송/디스코드%'
        OR i.summary LIKE '%🏰┃클랜/방송/디스코드%'
        OR i.summary LIKE '%클랜/방송/디스코드%'
        OR (mb.name IS NOT NULL AND (
          mb.name = '클랜/방송/디스코드'
          OR mb.name = '클랜 홍보'
          OR mb.name LIKE '%클랜/방송/디스코드%'
          OR mb.name LIKE '%클랜 홍보%'
          OR mb.name LIKE '%클랜홍보%'
        ))
        OR i.summary LIKE '%클랜%모집%'
        OR i.summary LIKE '%클랜모집%'
        OR i.summary LIKE '%모집%클랜%'
        OR i.summary LIKE '%클랜원%모집%'
        OR i.summary LIKE '%클랜원모집%'
        OR i.summary LIKE '%클원%모집%'
        OR i.summary LIKE '%클원모집%'
        OR i.summary LIKE '%클랜%가입%'
        OR i.summary LIKE '%클랜가입%'
        OR i.summary LIKE '%가입%클랜%'
        OR i.detail LIKE '%클랜%모집%'
        OR i.detail LIKE '%클랜모집%'
        OR i.detail LIKE '%모집%클랜%'
        OR i.detail LIKE '%클랜원%모집%'
        OR i.detail LIKE '%클랜원모집%'
        OR i.detail LIKE '%클원%모집%'
        OR i.detail LIKE '%클원모집%'
        OR i.detail LIKE '%클랜%가입%'
        OR i.detail LIKE '%클랜가입%'
        OR i.detail LIKE '%가입%클랜%'
        OR ((i.summary LIKE '[kakao]%' OR i.summary LIKE '[Kakao]%' OR i.summary LIKE '[KaKao]%' OR i.summary LIKE 'KaKao%') AND (
          i.summary LIKE '%클랜%'
          OR i.detail LIKE '%클랜%'
        ))
        OR i.summary LIKE '%디코서버%'
        OR i.summary LIKE '%디스코드 서버%'
        OR i.summary LIKE '%디스코드서버%'
        OR i.detail LIKE '%디코서버%'
        OR i.detail LIKE '%디스코드 서버%'
        OR i.detail LIKE '%디스코드서버%'
      )
  `;

  let sql = `
    SELECT
      COALESCE(mb.cafeGame, 'UNKNOWN') AS cafeGame,
      COUNT(*) AS total,
      SUM(CASE WHEN i.severity = 1 THEN 1 ELSE 0 END) AS sev1,
      SUM(CASE WHEN i.status IN ('OPEN','TRIAGED','IN_PROGRESS') THEN 1 ELSE 0 END) AS open
    FROM ReportItemIssue i
    LEFT JOIN MonitoredBoard mb ON i.monitoredBoardId = mb.id
    ${baseWhere}
      AND (
        (i.date >= ? AND i.date <= ?)
        OR (DATE(i.createdAt, '+9 hours') >= ? AND DATE(i.createdAt, '+9 hours') <= ?)
      )
  `;
  const params = [start, end, start, end];

  if (projectId !== undefined && projectId !== null) {
    sql += ' AND i.projectId = ?';
    params.push(projectId);
  }

  sql += ' GROUP BY COALESCE(mb.cafeGame, \'UNKNOWN\')';

  const rows = query(sql, params);
  const byCafeGame = {};
  rows.forEach((r) => {
    byCafeGame[String(r.cafeGame)] = {
      total: Number(r.total || 0),
      sev1: Number(r.sev1 || 0),
      open: Number(r.open || 0)
    };
  });

  return { startDate: start, endDate: end, projectId: projectId ?? null, byCafeGame };
}

/**
 * 특정 에이전트의 이슈 조회
 * @param {string} agentId - 에이전트 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Object>} 이슈 목록
 */
async function getIssuesByAgent(agentId, options = {}) {
  return getAllIssues({ ...options, agentId });
}

/**
 * 카테고리별 통계 조회
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Object>} 카테고리별 통계
 */
async function getCategoryStatistics(options = {}) {
  const { agentId, startDate, endDate, projectId } = options;
  
  return safeQuery(() => {
    let sql = `SELECT i.*, r.agentId as report_agentId 
               FROM ReportItemIssue i
               LEFT JOIN Report r ON i.reportId = r.id
               WHERE 1=1`;
    const params = [];
    
    if (agentId) {
      sql += ' AND r.agentId = ?';
      params.push(agentId);
    }
    if (projectId) {
      sql += ' AND i.projectId = ?';
      params.push(projectId);
    }
    if (startDate) {
      sql += ' AND i.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND i.date <= ?';
      params.push(endDate);
    }
    
    const issues = query(sql, params);
    
    // 카테고리 분류
    const categoryStats = {};
    
    issues.forEach(issue => {
      const contentToCategorize = `${issue.summary || ''} ${issue.detail || ''}`;
      const categoriesRaw = categorizeIssue(contentToCategorize);
      const categories = Array.isArray(categoriesRaw) && categoriesRaw.length > 0 ? categoriesRaw : ['기타'];
      const category = categories[0] || '기타';
      
      if (!categoryStats[category]) {
        categoryStats[category] = { count: 0, issues: [] };
      }
      categoryStats[category].count++;
      categoryStats[category].issues.push(issue.id);
    });
    
    return { categories: categoryStats };
  }, { categories: {} });
}

/**
 * 이슈 확인 (URL 클릭 또는 수동 체크)
 * @param {string} issueId - 이슈 ID
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Object>} 업데이트된 이슈
 */
async function checkIssue(issueId, agentId) {
  if (!issueId) {
    throw new Error('Issue ID is required');
  }
  
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  
  return safeQuery(() => {
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    
    if (!issue) {
      throw new Error('Issue not found');
    }
    
    // 이미 확인된 경우 업데이트하지 않음 (중복 방지)
    if (issue.checkedAt) {
      return issue;
    }
    
    const now = new Date().toISOString();
    execute(
      'UPDATE ReportItemIssue SET checkedAt = ?, checkedBy = ?, updatedAt = ? WHERE id = ?',
      [now, agentId, now, issueId]
    );
    
    const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    logger.info('Issue checked', { issueId, agentId });
    return updated;
  }, null);
}

/**
 * 이슈 처리 완료 체크
 * @param {string} issueId - 이슈 ID
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Object>} 업데이트된 이슈
 */
/**
 * 이슈를 보고서에서 제외
 */
async function excludeFromReport(issueId, agentId) {
  if (!issueId) {
    throw new Error('Issue ID is required');
  }
  
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  
  return safeQuery(() => {
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    
    if (!issue) {
      throw new Error('Issue not found');
    }
    
    // 보고서 제외 처리: excludedFromReport=true, processedAt 설정, status=RESOLVED
    const now = new Date().toISOString();
    execute(
      'UPDATE ReportItemIssue SET excludedFromReport = ?, excludedAt = ?, excludedBy = ?, processedAt = ?, processedBy = ?, status = ?, updatedAt = ? WHERE id = ?',
      [1, now, agentId, now, agentId, 'RESOLVED', now, issueId]
    );
    
    const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    if (updated.categoryGroupId) {
      updated.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [updated.categoryGroupId]);
    }
    if (updated.categoryId) {
      updated.category = queryOne('SELECT * FROM Category WHERE id = ?', [updated.categoryId]);
    }
    if (updated.assignedAgentId) {
      const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [updated.assignedAgentId]);
      updated.assignedAgent = ag
        ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
        : null;
    }
    
    logger.info('Issue excluded from report', { issueId, agentId });
    return updated;
  });
}

async function processIssue(issueId, agentId) {
  if (!issueId) {
    throw new Error('Issue ID is required');
  }
  
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  
  return safeQuery(() => {
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    
    if (!issue) {
      throw new Error('Issue not found');
    }
    
    const now = new Date().toISOString();
    execute(
      'UPDATE ReportItemIssue SET processedAt = ?, processedBy = ?, status = ?, updatedAt = ? WHERE id = ?',
      [now, agentId, 'RESOLVED', now, issueId]
    );
    
    const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    logger.info('Issue processed', { issueId, agentId });
    return updated;
  }, null);
}

/**
 * 이슈 상태 업데이트
 * @param {string} issueId - 이슈 ID
 * @param {Object} updateData - 업데이트 데이터
 * @param {number|null} userId - 수정한 사용자 ID (선택)
 * @returns {Promise<Object>} 업데이트된 이슈
 */
async function updateIssue(issueId, updateData, userId = null) {
  if (!issueId) {
    throw new Error('Issue ID is required');
  }
  
  return safeQuery(() => {
    // 기존 이슈 조회 (AI 분류 정보 포함)
    const oldIssue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);

    if (!oldIssue) {
      throw new Error('Issue not found');
    }

    const now = new Date().toISOString();
    const updateFields = [];
    const params = [];

    /** 이번 요청에서 categoryId가 (신규 값으로) 지정되면 분류 관리 중요도로 severity/importance 확정 — AI·수동 severity보다 우선 */
    const categoryImportanceToSeverity = { HIGH: 1, MEDIUM: 2, LOW: 3 };
    let categoryEnforced = null;
    if (updateData.categoryId !== undefined && updateData.categoryId) {
      const cat = queryOne('SELECT importance FROM Category WHERE id = ?', [updateData.categoryId]);
      if (cat && cat.importance) {
        categoryEnforced = {
          severity: categoryImportanceToSeverity[cat.importance] ?? 2,
          importance: cat.importance
        };
      }
    }

    if (updateData.status !== undefined) {
      const nextStatus = normalizeStatus(updateData.status);
      updateFields.push('status = ?');
      params.push(nextStatus);

      // A안: 완료(RESOLVED/VERIFIED)로 바꾸는 경우 processedAt/processedBy를 자동 기록(멱등)
      // updateIssue는 userId를 받으므로, 현재 로그인 사용자→Agent 매핑을 여기서 직접 조회한다.
      if ((nextStatus === 'RESOLVED' || nextStatus === 'VERIFIED') && (!oldIssue.processedAt || !oldIssue.processedBy)) {
        let agentId = null;
        const numericUserId = Number(userId);
        if (!Number.isNaN(numericUserId) && numericUserId) {
          const agent = queryOne('SELECT id FROM Agent WHERE userId = ?', [numericUserId]);
          agentId = agent ? agent.id : null;
        }
        if (agentId) {
          updateFields.push('processedAt = COALESCE(processedAt, ?)');
          params.push(now);
          updateFields.push('processedBy = COALESCE(processedBy, ?)');
          params.push(agentId);
        } else {
          logger.warn('[Issues] updateIssue status->resolved but agentId not found for user', {
            issueId,
            userId,
            nextStatus
          });
        }
      }
    }
    if (updateData.severity !== undefined && !categoryEnforced) {
      updateFields.push('severity = ?');
      params.push(updateData.severity);
      // severity에 따라 importance 자동 동기화
      const severityToImportance = {
        1: 'HIGH',
        2: 'MEDIUM',
        3: 'LOW'
      };
      updateFields.push('importance = ?');
      params.push(severityToImportance[updateData.severity] || 'MEDIUM');
    }
    if (updateData.assignedAgentId !== undefined) {
      updateFields.push('assignedAgentId = ?');
      params.push(updateData.assignedAgentId || null);
    }
    if (updateData.categoryGroupId !== undefined) {
      updateFields.push('categoryGroupId = ?');
      params.push(updateData.categoryGroupId || null);
    }
    if (updateData.categoryId !== undefined) {
      updateFields.push('categoryId = ?');
      params.push(updateData.categoryId || null);

      if (categoryEnforced) {
        updateFields.push('severity = ?');
        params.push(categoryEnforced.severity);
        updateFields.push('importance = ?');
        params.push(categoryEnforced.importance);
        logger.debug('[IssuesService] Category-first severity on update', {
          categoryId: updateData.categoryId,
          categoryImportance: categoryEnforced.importance,
          severity: categoryEnforced.severity
        });
      }
    }
    if (updateData.trend !== undefined) {
      updateFields.push('trend = ?');
      params.push(updateData.trend || null);
    }
    if (updateData.importance !== undefined && !categoryEnforced) {
      updateFields.push('importance = ?');
      params.push(updateData.importance);
    }
    if (updateData.sentiment !== undefined) {
      updateFields.push('sentiment = ?');
      params.push(updateData.sentiment);
    }
    if (updateData.aiClassificationReason !== undefined) {
      updateFields.push('aiClassificationReason = ?');
      params.push(updateData.aiClassificationReason || null);
    }
    if (updateData.detail !== undefined) {
      updateFields.push('detail = ?');
      params.push(updateData.detail || null);
    }
    if (updateData.summary !== undefined) {
      updateFields.push('summary = ?');
      params.push(updateData.summary || null);
    }
    
    if (updateFields.length === 0) {
      const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
      if (updated.categoryGroupId) {
        updated.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [updated.categoryGroupId]);
      }
      if (updated.categoryId) {
        updated.category = queryOne('SELECT * FROM Category WHERE id = ?', [updated.categoryId]);
      }
      if (updated.assignedAgentId) {
        const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [updated.assignedAgentId]);
        updated.assignedAgent = ag
          ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
          : null;
      }
      return updated;
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(issueId);
    
    execute(
      `UPDATE ReportItemIssue SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    if (updated.categoryGroupId) {
      updated.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [updated.categoryGroupId]);
    }
    if (updated.categoryId) {
      updated.category = queryOne('SELECT * FROM Category WHERE id = ?', [updated.categoryId]);
    }
    if (updated.assignedAgentId) {
      const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [updated.assignedAgentId]);
      updated.assignedAgent = ag
        ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
        : null;
    }
    
    // AI 분류 수정 감지 및 로그 저장
    const classificationFields = ['categoryGroupId', 'categoryId', 'severity', 'importance', 'trend'];
    const contentFields = ['detail', 'summary']; // 원문 필드
    const allTrackedFields = [...classificationFields, ...contentFields];
    const changedFields = [];
    
    for (const field of allTrackedFields) {
      const oldValue = oldIssue[field];
      const newValue = updated[field];
      
      // null과 undefined를 동일하게 처리
      const oldVal = oldValue === null || oldValue === undefined ? null : oldValue;
      const newVal = newValue === null || newValue === undefined ? null : newValue;
      
      if (oldVal !== newVal) {
        changedFields.push(field);
      }
    }
    
    // AI 분류 필드 또는 원문 필드가 변경된 경우 로그 저장
    const hasClassificationChange = changedFields.some(f => classificationFields.includes(f));
    const hasContentChange = changedFields.some(f => contentFields.includes(f));
    
    if (changedFields.length > 0) {
      // AI 분류 필드 변경 시 (AI 분류 정보가 있는 경우)
      if (hasClassificationChange && oldIssue.aiClassificationMethod) {
        try {
          // 사용자 ID로 Agent ID 찾기
          let agentId = null;
          if (userId) {
            agentId = findAgentIdForUser(userId);
          }
          
          // 원문 데이터
          const originalData = JSON.stringify({
            summary: oldIssue.summary,
            detail: oldIssue.detail,
            source: oldIssue.source
          });
          
          // AI 예측 데이터
          const aiPrediction = JSON.stringify({
            categoryGroupId: oldIssue.categoryGroupId,
            categoryId: oldIssue.categoryId,
            severity: oldIssue.severity,
            importance: oldIssue.importance,
            trend: oldIssue.trend,
            aiClassificationMethod: oldIssue.aiClassificationMethod,
            aiClassificationReason: oldIssue.aiClassificationReason
          });
          
          // 사용자 수정 데이터
          const userCorrection = JSON.stringify({
            categoryGroupId: updated.categoryGroupId,
            categoryId: updated.categoryId,
            severity: updated.severity,
            importance: updated.importance,
            trend: updated.trend
          });
          
          // 분류 로그 저장
          const { nanoid } = require('nanoid');
          const logId = nanoid();
          execute(
            'INSERT INTO AIClassificationLog (id, issueId, userId, agentId, originalData, aiPrediction, userCorrection, changedFields, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [logId, issueId, userId ? Number(userId) : null, agentId, originalData, aiPrediction, userCorrection, JSON.stringify(changedFields), new Date().toISOString()]
          );
          
          logger.info('AI classification log created', {
            issueId,
            userId,
            agentId,
            changedFields: changedFields.filter(f => classificationFields.includes(f))
          });
        } catch (logError) {
          // 로그 저장 실패해도 이슈 업데이트는 계속 진행
          logger.error('Failed to create AI classification log', {
            error: logError.message,
            issueId
          });
        }
      }
      
      // 원문 필드(detail, summary) 변경 시 별도 로그 생성
      if (hasContentChange) {
        try {
          // 사용자 ID로 Agent ID 찾기
          let agentId = null;
          if (userId) {
            agentId = findAgentIdForUser(userId);
          }
          
          // 원문 데이터 (수정 전)
          const originalContentData = JSON.stringify({
            summary: oldIssue.summary,
            detail: oldIssue.detail,
            source: oldIssue.source
          });
          
          // 수정된 원문 데이터
          const correctedContentData = JSON.stringify({
            summary: updated.summary,
            detail: updated.detail,
            source: updated.source
          });
          
          // 원문 수정 로그 저장 (AI 분류 로그와 별도)
          const { nanoid } = require('nanoid');
          const logId = nanoid();
          execute(
            'INSERT INTO AIClassificationLog (id, issueId, userId, agentId, originalData, aiPrediction, userCorrection, changedFields, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [logId, issueId, userId ? Number(userId) : null, agentId, originalContentData, JSON.stringify({}), correctedContentData, JSON.stringify(changedFields.filter(f => contentFields.includes(f))), new Date().toISOString()]
          );
          
          logger.info('Content modification log created', {
            issueId,
            userId,
            agentId,
            changedFields: changedFields.filter(f => contentFields.includes(f))
          });
        } catch (logError) {
          // 로그 저장 실패해도 이슈 업데이트는 계속 진행
          logger.error('Failed to create content modification log', {
            error: logError.message,
            issueId
          });
        }
      }
    }
    
    logger.info('Issue updated', { issueId, updateData });
    return updated;
  }, null);
}

async function assignIssue(issueId, agentId, projectId) {
  const normalizedProjectId = normalizeProjectIdInput(projectId);
  
  // agentId가 null이면 담당자 해제, 아니면 에이전트 존재 확인
  if (agentId) {
    await ensureAgentExists(agentId);
  }
  
  await ensureIssueInProject(issueId, normalizedProjectId);

  const now = new Date().toISOString();
  execute(
    'UPDATE ReportItemIssue SET assignedAgentId = ?, updatedAt = ? WHERE id = ?',
    [agentId || null, now, issueId]
  );
  
  const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
  if (updated.assignedAgentId) {
    const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [updated.assignedAgentId]);
    updated.assignedAgent = ag
      ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
      : null;
  } else {
    updated.assignedAgent = null;
  }
  
  // assignedAgentName 필드 추가
  updated.assignedAgentName = updated.assignedAgent?.name || null;
  
  return updated;
}

async function updateIssueStatus(issueId, status, projectId) {
  if (!status) {
    throw new Error('Status is required');
  }
  const normalizedProjectId = normalizeProjectIdInput(projectId);
  await ensureIssueInProject(issueId, normalizedProjectId);
  const normalizedStatus = normalizeStatus(status);

  const now = new Date().toISOString();
  // RESOLVED/VERIFIED로 변경되는 경우, 성과 분석 집계를 위해 processedAt/processedBy를 함께 기록한다.
  // 단, 이미 값이 있는 경우 덮어쓰지 않는다(멱등).
  // NOTE: agentId는 컨트롤러에서 현재 로그인 사용자 기준으로 매핑해서 전달한다.
  const issue = queryOne('SELECT processedAt, processedBy FROM ReportItemIssue WHERE id = ?', [issueId]);
  const shouldMarkProcessed = (normalizedStatus === 'RESOLVED' || normalizedStatus === 'VERIFIED');
  const agentId = arguments.length >= 4 ? arguments[3] : null; // backward-compatible optional param

  if (shouldMarkProcessed && agentId && (!issue?.processedAt || !issue?.processedBy)) {
    execute(
      'UPDATE ReportItemIssue SET status = ?, processedAt = COALESCE(processedAt, ?), processedBy = COALESCE(processedBy, ?), updatedAt = ? WHERE id = ?',
      [normalizedStatus, now, agentId, now, issueId]
    );
  } else {
    execute(
      'UPDATE ReportItemIssue SET status = ?, updatedAt = ? WHERE id = ?',
      [normalizedStatus, now, issueId]
    );
  }
  
  return queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
}

async function getIssueComments(issueId, projectId) {
  const normalizedProjectId = normalizeProjectIdInput(projectId);
  await ensureIssueInProject(issueId, normalizedProjectId);
  
  const comments = query(
    'SELECT c.*, a.id as author_id, a.name as author_name, a.email as author_email FROM IssueComment c LEFT JOIN Agent a ON c.authorId = a.id WHERE c.issueId = ? ORDER BY c.createdAt ASC',
    [issueId]
  );
  
  return comments.map(c => {
    const { author_email, ...row } = c;
    return {
      ...row,
      author: c.author_id
        ? {
            id: c.author_id,
            name: resolveAgentDisplayName(c.author_name, author_email),
          }
        : null,
    };
  });
}

async function addIssueComment(issueId, body, authorAgentId, projectId) {
  if (!body || !body.trim()) {
    throw new Error('Comment body is required');
  }
  const normalizedProjectId = normalizeProjectIdInput(projectId);
  await ensureIssueInProject(issueId, normalizedProjectId);

  if (authorAgentId) {
    await ensureAgentExists(authorAgentId);
  }

  const now = new Date().toISOString();
  const result = execute(
    'INSERT INTO IssueComment (issueId, authorId, body, createdAt) VALUES (?, ?, ?, ?)',
    [issueId, authorAgentId || null, body.trim(), now]
  );
  
  const comment = queryOne('SELECT * FROM IssueComment WHERE id = ?', [result.lastInsertRowid]);
  if (comment.authorId) {
    const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [comment.authorId]);
    comment.author = ag
      ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
      : null;
  }
  return comment;
}

/**
 * 이슈 행 포맷팅 헬퍼 함수
 */
function formatIssueRow(issue) {
  const { assignedAgent_email, ...row } = issue;
  const assignedName = resolveAgentDisplayName(issue.assignedAgent_name, assignedAgent_email);
  return {
    ...row,
    status: normalizeStatus(issue.status),
    agentId: issue.report_agentId,
    assignedAgentName: assignedName || null,
    assignedAgent: issue.assignedAgent_id ? { id: issue.assignedAgent_id, name: assignedName } : null,
    categoryGroup: issue.categoryGroup_id ? { id: issue.categoryGroup_id, name: issue.categoryGroup_name, code: issue.categoryGroup_code, color: issue.categoryGroup_color } : null,
    category: issue.category_id ? { id: issue.category_id, name: issue.category_name } : null,
    monitoredBoard: issue.monitoredBoard_id ? { id: issue.monitoredBoard_id, cafeGame: issue.monitoredBoard_cafeGame, name: issue.monitoredBoard_name } : null,
    isHotTopic: Boolean(issue.isHotTopic),
    hasImages: Boolean(issue.hasImages),
    requiresLogin: Boolean(issue.requiresLogin),
    excludedFromReport: Boolean(issue.excludedFromReport),
    postImagePaths: normalizePostImagePaths(issue.postImagePaths)
  };
}

/**
 * 클랜 게시글 조회 및 알림 규칙 체크
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Object>} 클랜 게시글 목록 및 알림 정보
 */
/** 클랜 API 최대 limit (서버 부하 완화) */
const CLAN_MAX_LIMIT = 1000;

/**
 * 중복 홍보 검사는 페이지(limit)와 무관하게 동일 필터의 글끼리 비교해야 함.
 * 행이 매우 많을 때만 상한 (최신순 우선).
 */
const CLAN_DUPLICATE_SCAN_MAX = 25000;

/** 클랜 목록에서 태그된 RawLog의 게시글 id 집합 (상관 EXISTS 대신 1회 스캔 — 이슈 4만 건+에서 메인 스레드 멈춤 방지) */
const CLAN_TAGGED_ARTICLE_IDS_SUBQUERY = `
SELECT r.articleId FROM RawLog r
WHERE r.source = 'naver'
  AND json_extract(r.metadata, '$.naverCollection') = 'clan'
  AND r.articleId IS NOT NULL AND TRIM(CAST(r.articleId AS TEXT)) != ''
UNION
SELECT CAST(json_extract(r.metadata, '$.externalPostId') AS TEXT) FROM RawLog r
WHERE r.source = 'naver'
  AND json_extract(r.metadata, '$.naverCollection') = 'clan'
  AND json_extract(r.metadata, '$.externalPostId') IS NOT NULL
  AND TRIM(CAST(json_extract(r.metadata, '$.externalPostId') AS TEXT)) != ''
`;

/**
 * 클랜 이슈 SQL의 `mb.id IN (...)` 분기용 id (부모판·FE 메뉴 URL 등).
 * env 명시 id와 실제 클랜 워커 타깃 id(getClanWorkerTargetMonitoredBoardIds)를 합쳐,
 * 워커가 이름 패턴 행만 스캔해도·부모 id만 env에 남아 있어도 집계가 어긋나지 않게 함.
 */
function getExplicitClanMonitoredBoardIds() {
  const fromEnv = getClanDedicatedMonitoredBoardIds();
  let fromWorker = [];
  try {
    fromWorker = getClanWorkerTargetMonitoredBoardIds();
  } catch (e) {
    logger.warn('[issues.service] getClanWorkerTargetMonitoredBoardIds failed; using env ids only', {
      error: e.message
    });
  }
  return [...new Set([...fromEnv, ...fromWorker])].sort((a, b) => a - b);
}

/**
 * FE 클랜 전용 메뉴 id (f-e …/menus/178, article?menuid=178). naverCafeClan.worker CLAN_MENU_ID 와 맞출 것.
 * NAVER_CAFE_CLAN_MENU_IDS=178,179 또는 단일 NAVER_CAFE_CLAN_MENU_ID
 */
function getClanFeMenuIdsForIssueFilter() {
  const raw = process.env.NAVER_CAFE_CLAN_MENU_IDS || process.env.NAVER_CAFE_CLAN_MENU_ID || '178';
  const ids = String(raw)
    .split(/[,;\s]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  return ids.length > 0 ? ids : [178];
}

/** sourceUrl 이 위 메뉴(들)에 속한 글인지 — 일반 PC 워커로 수집돼도 클랜 목록에 포함 */
function sqlClanFeMenuSourceUrlMatch(columnRef) {
  const parts = [];
  for (const mid of getClanFeMenuIdsForIssueFilter()) {
    parts.push(`(${columnRef} LIKE '%menuid=${mid}%')`);
    parts.push(`(${columnRef} LIKE '%/menus/${mid}%')`);
  }
  return parts.join(' OR ');
}

/**
 * MonitoredBoard 행이 클랜 정의에 맞는지 — EXISTS / INNER JOIN 공통
 * @param {string} tableAlias 예: mb, mb2
 * @param {number[]} explicitIds getExplicitClanMonitoredBoardIds()
 */
function buildClanMonitoredBoardMatchSql(tableAlias, explicitIds) {
  const { codes, clanSources, baseSources } = crawlerGames.getClanIssueSqlConstants();
  const codePh = codes.map(() => '?').join(',');
  const clanPh = clanSources.map(() => '?').join(',');
  const basePh = baseSources.map(() => '?').join(',');
  const params = [...codes];
  let sql = `${tableAlias}.cafeGame IN (${codePh}) AND (`;
  sql += `(${tableAlias}.name LIKE '%클랜/방송/디스코드%' OR ${tableAlias}.name LIKE '%클랜방송디스코드%')`;
  if (explicitIds.length > 0) {
    const ph2 = explicitIds.map(() => '?').join(',');
    const feMenuSrcCount = sqlClanFeMenuSourceUrlMatch('i.sourceUrl');
    sql += ` OR (${tableAlias}.id IN (${ph2}) AND (
          i.externalSource IN (${clanPh})
          OR (
            i.externalPostId IS NOT NULL AND TRIM(i.externalPostId) != ''
            AND i.externalPostId IN (${CLAN_TAGGED_ARTICLE_IDS_SUBQUERY})
          )
          OR (
            i.externalSource IN (${basePh})
            AND i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != ''
            AND (${feMenuSrcCount})
          )
        ))`;
    params.push(...explicitIds, ...clanSources, ...baseSources);
  }
  sql += ')';
  return { sql, params };
}

/**
 * 클랜 API 전용 날짜 범위: 원글일(i.date)·원본 시각(sourceCreatedAt)·수집 시각(createdAt) KST 중 하나라도 범위에 들어가면 포함.
 * (기존: i.date만 사용 시 "어제 작성·오늘 수집"이 오늘 필터에서 전부 탈락 → 수집 로그와 목록 건수 불일치)
 */
function buildClanIssueDateFilterClause(startDate, endDate) {
  if (!startDate && !endDate) {
    return { clause: '', params: [] };
  }
  // i.date는 문자열 컬럼: ISO(YYYY-MM-DD…)는 date()로도 비교해 형식 차이에 덜 취약하게 함
  const dateStrRange = `(
      (i.date >= ? AND i.date <= ?)
      OR (date(i.date) IS NOT NULL AND date(i.date) >= date(?) AND date(i.date) <= date(?))
    )`;
  const dateStrFrom = `((i.date >= ?) OR (date(i.date) IS NOT NULL AND date(i.date) >= date(?)))`;
  const dateStrTo = `((i.date <= ?) OR (date(i.date) IS NOT NULL AND date(i.date) <= date(?)))`;
  if (startDate && endDate) {
    return {
      clause: ` AND (
      (i.date IS NOT NULL AND TRIM(CAST(i.date AS TEXT)) != '' AND ${dateStrRange})
      OR (i.sourceCreatedAt IS NOT NULL AND DATE(i.sourceCreatedAt, '+9 hours') >= ? AND DATE(i.sourceCreatedAt, '+9 hours') <= ?)
      OR (DATE(i.createdAt, '+9 hours') >= ? AND DATE(i.createdAt, '+9 hours') <= ?)
    )`,
      params: [
        startDate,
        endDate,
        startDate,
        endDate,
        startDate,
        endDate,
        startDate,
        endDate
      ]
    };
  }
  if (startDate) {
    return {
      clause: ` AND (
      (i.date IS NOT NULL AND TRIM(CAST(i.date AS TEXT)) != '' AND ${dateStrFrom})
      OR (i.sourceCreatedAt IS NOT NULL AND DATE(i.sourceCreatedAt, '+9 hours') >= ?)
      OR (DATE(i.createdAt, '+9 hours') >= ?)
    )`,
      params: [startDate, startDate, startDate, startDate]
    };
  }
  return {
    clause: ` AND (
      (i.date IS NOT NULL AND TRIM(CAST(i.date AS TEXT)) != '' AND ${dateStrTo})
      OR (i.sourceCreatedAt IS NOT NULL AND DATE(i.sourceCreatedAt, '+9 hours') <= ?)
      OR (DATE(i.createdAt, '+9 hours') <= ?)
    )`,
    params: [endDate, endDate, endDate, endDate]
  };
}

/**
 * 클랜 게시글 목록(getClanIssues total)과 동일한 WHERE로 건수만 조회
 */
function countClanIssues({ startDate, endDate, projectId, ids } = {}) {
  let countSql = `SELECT COUNT(*) as count
                  FROM ReportItemIssue i
                  WHERE 1=1`;
  const countParams = [];

  const clanCountDateFilter = buildClanIssueDateFilterClause(startDate, endDate);
  countSql += clanCountDateFilter.clause;
  countParams.push(...clanCountDateFilter.params);

  if (projectId !== undefined && projectId !== null) {
    countSql += ' AND i.projectId = ?';
    countParams.push(projectId);
  }

  const countExplicitIds = getExplicitClanMonitoredBoardIds();
  const clanMb2Count = buildClanMonitoredBoardMatchSql('mb2', countExplicitIds);
  countSql += ` AND i.monitoredBoardId IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM MonitoredBoard mb2
                  WHERE mb2.id = i.monitoredBoardId
                  AND ${clanMb2Count.sql}
                )`;
  countParams.push(...clanMb2Count.params);

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    countSql += ` AND i.id IN (${placeholders})`;
    countParams.push(...ids);
  }

  const countResult = queryOne(countSql, countParams);
  return countResult ? Number(countResult.count) || 0 : 0;
}

/**
 * 클랜 목록 정의에 해당하는 이슈를 monitoredBoardId별로 센다 (게시판별 통계 보정용).
 */
function countClanMatchesGroupedByMonitoredBoard(monitoredBoardIds, { startDate, endDate, projectId }) {
  if (!Array.isArray(monitoredBoardIds) || monitoredBoardIds.length === 0) {
    return new Map();
  }
  const ph = monitoredBoardIds.map(() => '?').join(',');
  let sql = `SELECT i.monitoredBoardId as boardId, COUNT(*) as count
             FROM ReportItemIssue i
             INNER JOIN MonitoredBoard mb ON mb.id = i.monitoredBoardId
             WHERE i.monitoredBoardId IN (${ph})`;
  const params = [...monitoredBoardIds];

  const dateFilter = buildClanIssueDateFilterClause(startDate, endDate);
  sql += dateFilter.clause;
  params.push(...dateFilter.params);

  if (projectId !== undefined && projectId !== null) {
    sql += ' AND i.projectId = ?';
    params.push(projectId);
  }

  const explicitIdsGrouped = getExplicitClanMonitoredBoardIds();
  const clanMbGrouped = buildClanMonitoredBoardMatchSql('mb', explicitIdsGrouped);
  sql += ` AND ${clanMbGrouped.sql}`;
  params.push(...clanMbGrouped.params);
  sql += ' GROUP BY i.monitoredBoardId';

  const rows = query(sql, params);
  return new Map(
    rows.map((r) => {
      const bid = Number(r.boardId);
      return [Number.isNaN(bid) ? r.boardId : bid, Number(r.count) || 0];
    })
  );
}

function getClanReconciliationCandidateBoards(activeBoards) {
  const explicit = new Set(getExplicitClanMonitoredBoardIds());
  const clanCodes = new Set(crawlerGames.getClanCompatibleCafeGameCodes());
  return activeBoards.filter((b) => {
    if (!clanCodes.has(b.cafeGame)) return false;
    const n = `${String(b.name || '')} ${String(b.label || '')}`;
    if (n.includes('클랜/방송/디스코드') || n.includes('클랜방송디스코드')) return true;
    if (explicit.has(b.id)) return true;
    return false;
  });
}

/** 클랜 총건 표시 행: 이름「클랜/방송/디스코드」행을 explicit 부모판 id보다 우선 */
function resolveClanDisplayBoardId(activeBoards) {
  const candidates = getClanReconciliationCandidateBoards(activeBoards);
  if (candidates.length === 0) return null;

  const nameHits = candidates.filter((b) => {
    const n = `${String(b.name || '')} ${String(b.label || '')}`;
    return n.includes('클랜/방송/디스코드') || n.includes('클랜방송디스코드');
  });
  if (nameHits.length === 1) return Number(nameHits[0].id);
  if (nameHits.length > 1) return Math.min(...nameHits.map((b) => Number(b.id)));

  const boardIdSet = new Set(activeBoards.map((b) => Number(b.id)));
  const explicitOrder = getExplicitClanMonitoredBoardIds();
  for (const eid of explicitOrder) {
    const en = Number(eid);
    if (!Number.isNaN(en) && boardIdSet.has(en) && candidates.some((c) => Number(c.id) === en)) return en;
  }

  if (candidates.length === 1) return Number(candidates[0].id);
  return Math.min(...candidates.map((b) => Number(b.id)));
}

/** 클랜 정의 이슈의 일별 이슈 등록일(KST) */
function queryClanIssuesDailyIngestKst({ startDate, endDate, projectId } = {}) {
  let sql = `
    SELECT DATE(i.createdAt, '+9 hours') AS date, COUNT(*) AS count
    FROM ReportItemIssue i
    WHERE i.monitoredBoardId IS NOT NULL`;
  const params = [];

  if (projectId !== undefined && projectId !== null) {
    sql += ' AND i.projectId = ?';
    params.push(projectId);
  }
  if (startDate) {
    sql += ` AND DATE(i.createdAt, '+9 hours') >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND DATE(i.createdAt, '+9 hours') <= ?`;
    params.push(endDate);
  }

  const countExplicitIdsDaily = getExplicitClanMonitoredBoardIds();
  const clanMb2Daily = buildClanMonitoredBoardMatchSql('mb2', countExplicitIdsDaily);
  sql += ` AND EXISTS (
    SELECT 1 FROM MonitoredBoard mb2
    WHERE mb2.id = i.monitoredBoardId
    AND ${clanMb2Daily.sql}
  )`;
  params.push(...clanMb2Daily.params);
  sql += ` GROUP BY date ORDER BY date DESC LIMIT 90`;
  return query(sql, params);
}

async function getClanIssues(options = {}) {
  const {
    startDate,
    endDate,
    projectId,
    limit,
    offset = 0,
    ids
  } = options;

  const effectiveLimit = limit != null ? Math.min(parseInt(limit, 10) || CLAN_MAX_LIMIT, CLAN_MAX_LIMIT) : undefined;

  logger.debug('getClanIssues service called', {
    startDate,
    endDate,
    projectId,
    limit,
    effectiveLimit,
    offset
  });

  try {
    // 클랜 관련 게시글 조회
    // PUBG PC의 클랜/방송/디스코드 게시판에서 수집된 게시글만 표시
    let sql = `SELECT i.*, r.agentId as report_agentId,
               a.id as assignedAgent_id, a.name as assignedAgent_name, a.email as assignedAgent_email,
               cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
               c.id as category_id, c.name as category_name,
               mb.id as monitoredBoard_id, mb.cafeGame as monitoredBoard_cafeGame, mb.name as monitoredBoard_name
               FROM ReportItemIssue i
               LEFT JOIN Report r ON i.reportId = r.id
               LEFT JOIN Agent a ON i.assignedAgentId = a.id
               LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
               LEFT JOIN Category c ON i.categoryId = c.id
               LEFT JOIN MonitoredBoard mb ON i.monitoredBoardId = mb.id
               WHERE 1=1`;
    const params = [];

    const clanDateFilter = buildClanIssueDateFilterClause(startDate, endDate);
    sql += clanDateFilter.clause;
    params.push(...clanDateFilter.params);

    if (projectId !== undefined && projectId !== null) {
      sql += ' AND i.projectId = ?';
      params.push(projectId);
    }

    const explicitClanBoardIds = getExplicitClanMonitoredBoardIds();
    const clanMbList = buildClanMonitoredBoardMatchSql('mb', explicitClanBoardIds);
    sql += ` AND i.monitoredBoardId IS NOT NULL AND ${clanMbList.sql}`;
    params.push(...clanMbList.params);

    // ids 지정 시 해당 ID만 조회 (관련 글 같이 보기용)
    if (ids && Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      sql += ` AND i.id IN (${placeholders})`;
      params.push(...ids);
    }

    const fromMarker = 'FROM ReportItemIssue i';
    const fromIdx = sql.indexOf(fromMarker);
    if (fromIdx === -1) {
      logger.error('getClanIssues: expected FROM ReportItemIssue i in SQL');
      throw new Error('Clan issues query shape changed; cannot run duplicate scan');
    }
    const dupSelect =
      'SELECT i.id, i.date, i.createdAt, i.summary, i.sourceUrl, i.sourceCreatedAt, i.externalPostId ';
    const dupScanSql = dupSelect + sql.slice(fromIdx);
    const dupScanParams = [...params];
    const dupRows = query(
      `${dupScanSql} ORDER BY i.createdAt DESC LIMIT ?`,
      [...dupScanParams, CLAN_DUPLICATE_SCAN_MAX]
    );
    if (dupRows.length >= CLAN_DUPLICATE_SCAN_MAX) {
      logger.warn('[getClanIssues] duplicate promotion scan hit row cap', {
        cap: CLAN_DUPLICATE_SCAN_MAX
      });
    }

    const duplicateAlerts = await checkDuplicateClanPromotions(dedupeClanIssueRowsById(dupRows));

    sql += ' ORDER BY i.createdAt DESC';

    if (limit) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const issues = query(sql, params);

    // 이슈 데이터 포맷팅
    const formattedIssues = issues.map(issue => formatIssueRow(issue));
    const duplicateAlertMap = {};
    duplicateAlerts.forEach(alert => {
      if (!duplicateAlertMap[alert.issueId]) {
        duplicateAlertMap[alert.issueId] = [];
      }
      duplicateAlertMap[alert.issueId].push(alert);
    });

    // 각 이슈에 알림 규칙 체크
    const issuesWithAlerts = formattedIssues.map(issue => {
      const alerts = checkClanIssueAlerts(issue);
      // 중복 홍보 알림 추가
      if (duplicateAlertMap[issue.id]) {
        alerts.push(...duplicateAlertMap[issue.id]);
      }
      return {
        ...issue,
        alerts
      };
    });

    const total = countClanIssues({ startDate, endDate, projectId, ids });

    return {
      issues: issuesWithAlerts,
      total,
      limit: effectiveLimit ?? null,
      offset
    };
  } catch (error) {
    logger.error('Failed to get clan issues', { error: error.message });
    throw error;
  }
}

/**
 * 카드 교환(네이버 카페 FE 메뉴) 게시글 조회
 * - PUBG Mobile 공식 카페: f-e .../menus/230
 * - ⚠️ 원문 URL(/articles/{id})는 menuid/menus 정보를 포함하지 않는 경우가 많다.
 *   따라서 (1) MonitoredBoard의 listUrl/url에 menus/230(또는 menuid=230)이 등록된 보드 id가 있으면 그 보드 id로 필터,
 *   (2) 그 외에는 sourceUrl에 menuid/menus 흔적이 있는 경우만 포함한다.
 */
const CARD_EXCHANGE_MAX_LIMIT = 2000;

function getCardExchangeFeMenuIdsForIssueFilter() {
  const raw =
    process.env.NAVER_CAFE_CARD_EXCHANGE_MENU_IDS ||
    process.env.NAVER_CAFE_CARD_EXCHANGE_MENU_ID ||
    '230';
  const ids = String(raw)
    .split(/[,;\s]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  return ids.length > 0 ? ids : [230];
}

function sqlCardExchangeFeMenuSourceUrlMatch(columnRef) {
  const parts = [];
  for (const mid of getCardExchangeFeMenuIdsForIssueFilter()) {
    parts.push(`(${columnRef} LIKE '%menuid=${mid}%')`);
    parts.push(`(${columnRef} LIKE '%/menus/${mid}%')`);
  }
  return parts.join(' OR ');
}

function getCardExchangeBoardIdsFromEnvForIssues() {
  const raw = process.env.NAVER_CAFE_CARD_EXCHANGE_BOARD_IDS || '';
  if (!String(raw).trim()) return [];
  return [
    ...new Set(
      String(raw)
        .split(/[,;\s]+/)
        .map((s) => parseInt(String(s).trim(), 10))
        .filter((n) => !Number.isNaN(n) && n > 0)
    )
  ];
}

function normalizeIntIds(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const id = r && r.id;
    if (id == null) continue;
    const n = typeof id === 'bigint' ? Number(id) : parseInt(String(id), 10);
    if (!Number.isNaN(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
}

function getCardExchangeMonitoredBoardIdsFromDb() {
  const fromEnvRaw = getCardExchangeBoardIdsFromEnvForIssues();
  const fromEnv = [];
  for (const id of fromEnvRaw) {
    const row = queryOne('SELECT id, cafeGame FROM MonitoredBoard WHERE id = ?', [id]);
    if (row && row.cafeGame === 'PUBG_MOBILE') fromEnv.push(id);
  }
  try {
    const mids = getCardExchangeFeMenuIdsForIssueFilter();
    const conditions = [];
    for (const mid of mids) {
      conditions.push(`url LIKE '%/menus/${mid}%'`);
      conditions.push(`url LIKE '%menuid=${mid}%'`);
      conditions.push(`listUrl LIKE '%/menus/${mid}%'`);
      conditions.push(`listUrl LIKE '%menuid=${mid}%'`);
    }
    const where = conditions.length > 0 ? `(${conditions.join(' OR ')})` : '1=0';
    const rows = query(
      `SELECT id FROM MonitoredBoard WHERE cafeGame = 'PUBG_MOBILE' AND ${where}`,
      []
    );
    const fromDb = normalizeIntIds(rows);
    return [...new Set([...fromEnv, ...fromDb])].sort((a, b) => a - b);
  } catch {
    return [...fromEnv].sort((a, b) => a - b);
  }
}

/**
 * 게시판별 건수에서 카드 교환 목록 총건을 어느 MonitoredBoard 행에 붙일지 결정.
 * 메뉴 URL이 같은 공식 카페·카드 교환 두 줄이 동시에 잡히는 경우가 많아, 단일 ID일 때만 쓰면 안 맞음.
 * 우선순위: NAVER_CAFE_CARD_EXCHANGE_BOARD_IDS(활성 목록에 있을 때) → 이름·라벨에 '카드 교환' → 후보 1개 → 후보 중 최소 id
 */
function resolveCardExchangeDisplayBoardId(activeBoards, cardExchangeBoardIds) {
  const idSet = new Set(cardExchangeBoardIds.map((id) => Number(id)));
  const candidates = activeBoards.filter(
    (b) => idSet.has(Number(b.id)) && b.cafeGame === 'PUBG_MOBILE'
  );
  if (candidates.length === 0) return null;

  const boardIdSet = new Set(activeBoards.map((b) => Number(b.id)));
  const envIds = getCardExchangeBoardIdsFromEnvForIssues();
  for (const eid of envIds) {
    const en = Number(eid);
    const row = activeBoards.find((b) => Number(b.id) === en);
    if (row && row.cafeGame === 'PUBG_MOBILE' && boardIdSet.has(en) && idSet.has(en)) return en;
  }

  const nameHits = candidates.filter((b) => {
    const n = `${String(b.name || '')} ${String(b.label || '')}`;
    return /카드\s*교환|카드교환/i.test(n);
  });
  if (nameHits.length === 1) return Number(nameHits[0].id);
  if (nameHits.length > 1) return Math.min(...nameHits.map((b) => Number(b.id)));

  if (candidates.length === 1) return Number(candidates[0].id);
  return Math.min(...candidates.map((b) => Number(b.id)));
}

/**
 * 카드 교환 목록(getCardExchangeIssues)과 동일한 WHERE로 이슈 건수만 조회
 */
function countCardExchangeIssues({ startDate, endDate, projectId }) {
  let countSql = `SELECT COUNT(*) as count
                  FROM ReportItemIssue i
                  LEFT JOIN MonitoredBoard mb2 ON i.monitoredBoardId = mb2.id
                  WHERE 1=1`;
  const countParams = [];

  const countDateFilter = buildClanIssueDateFilterClause(startDate, endDate);
  countSql += countDateFilter.clause;
  countParams.push(...countDateFilter.params);

  if (projectId !== undefined && projectId !== null) {
    countSql += ' AND i.projectId = ?';
    countParams.push(projectId);
  }

  const menuMatchCount = sqlCardExchangeFeMenuSourceUrlMatch('i.sourceUrl');
  const boardIdsCount = getCardExchangeMonitoredBoardIdsFromDb();
  countSql += ` AND i.monitoredBoardId IS NOT NULL
                AND mb2.cafeGame = 'PUBG_MOBILE'
                AND (`;
  if (boardIdsCount.length > 0) {
    const ph2 = boardIdsCount.map(() => '?').join(',');
    countSql += ` i.monitoredBoardId IN (${ph2})
                  OR (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatchCount}))
                  OR (i.summary LIKE '🖼️카드 교환%')`;
    countParams.push(...boardIdsCount);
  } else {
    countSql += ` (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatchCount}))
                  OR (i.summary LIKE '🖼️카드 교환%')`;
  }
  countSql += ` )`;

  const countResult = queryOne(countSql, countParams);
  return countResult ? Number(countResult.count) || 0 : 0;
}

/**
 * 카드 교환 정의에 해당하는 이슈를 monitoredBoardId별로 센다 (게시판별 통계 보정용).
 */
function countCardExchangeMatchesGroupedByMonitoredBoard(monitoredBoardIds, { startDate, endDate, projectId }) {
  if (!Array.isArray(monitoredBoardIds) || monitoredBoardIds.length === 0) {
    return new Map();
  }
  const ph = monitoredBoardIds.map(() => '?').join(',');
  let sql = `SELECT i.monitoredBoardId as boardId, COUNT(*) as count
             FROM ReportItemIssue i
             LEFT JOIN MonitoredBoard mb ON i.monitoredBoardId = mb.id
             WHERE i.monitoredBoardId IN (${ph})`;
  const params = [...monitoredBoardIds];

  const dateFilter = buildClanIssueDateFilterClause(startDate, endDate);
  sql += dateFilter.clause;
  params.push(...dateFilter.params);

  if (projectId !== undefined && projectId !== null) {
    sql += ' AND i.projectId = ?';
    params.push(projectId);
  }

  const menuMatch = sqlCardExchangeFeMenuSourceUrlMatch('i.sourceUrl');
  const cardBids = getCardExchangeMonitoredBoardIdsFromDb();
  sql += ` AND i.monitoredBoardId IS NOT NULL
           AND mb.cafeGame = 'PUBG_MOBILE'
           AND (`;
  if (cardBids.length > 0) {
    const ph2 = cardBids.map(() => '?').join(',');
    sql += ` i.monitoredBoardId IN (${ph2})
             OR (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatch}))
             OR (i.summary LIKE '🖼️카드 교환%')`;
    params.push(...cardBids);
  } else {
    sql += ` (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatch}))
             OR (i.summary LIKE '🖼️카드 교환%')`;
  }
  sql += ` ) GROUP BY i.monitoredBoardId`;

  const rows = query(sql, params);
  return new Map(
    rows.map((r) => {
      const bid = Number(r.boardId);
      return [Number.isNaN(bid) ? r.boardId : bid, Number(r.count) || 0];
    })
  );
}

async function getCardExchangeIssues(options = {}) {
  const { startDate, endDate, projectId, limit, offset = 0 } = options;

  const effectiveLimit =
    limit != null
      ? Math.min(parseInt(limit, 10) || CARD_EXCHANGE_MAX_LIMIT, CARD_EXCHANGE_MAX_LIMIT)
      : undefined;

  try {
    let sql = `SELECT i.*, r.agentId as report_agentId,
               a.id as assignedAgent_id, a.name as assignedAgent_name, a.email as assignedAgent_email,
               cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
               c.id as category_id, c.name as category_name,
               mb.id as monitoredBoard_id, mb.cafeGame as monitoredBoard_cafeGame, mb.name as monitoredBoard_name
               FROM ReportItemIssue i
               LEFT JOIN Report r ON i.reportId = r.id
               LEFT JOIN Agent a ON i.assignedAgentId = a.id
               LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
               LEFT JOIN Category c ON i.categoryId = c.id
               LEFT JOIN MonitoredBoard mb ON i.monitoredBoardId = mb.id
               WHERE 1=1`;
    const params = [];

    // 날짜 필터는 클랜과 동일: 원글일/원본시각/수집시각(KST) 중 하나라도 범위에 들어가면 포함
    const dateFilter = buildClanIssueDateFilterClause(startDate, endDate);
    sql += dateFilter.clause;
    params.push(...dateFilter.params);

    if (projectId !== undefined && projectId !== null) {
      sql += ' AND i.projectId = ?';
      params.push(projectId);
    }

    const menuMatch = sqlCardExchangeFeMenuSourceUrlMatch('i.sourceUrl');
    const boardIds = getCardExchangeMonitoredBoardIdsFromDb();
    sql += ` AND i.monitoredBoardId IS NOT NULL
             AND mb.cafeGame = 'PUBG_MOBILE'
             AND (`;
    if (boardIds.length > 0) {
      const ph = boardIds.map(() => '?').join(',');
      // ⚠️ sourceUrl(/articles/{id})에는 menuid가 없을 때가 많아, 보드 태깅 누락 시 빠질 수 있음.
      // 관리 화면의 실제 행 수와 맞추기 위해 '🖼️카드 교환' 접두어(목록에서 찍히는 표기)도 카드교환으로 포함한다.
      sql += ` i.monitoredBoardId IN (${ph})
               OR (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatch}))
               OR (i.summary LIKE '🖼️카드 교환%')`;
      params.push(...boardIds);
    } else {
      // 보드가 menus/230로 등록돼있지 않으면 URL 매칭만으로는 대부분 잡히지 않을 수 있음
      sql += ` (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatch}))
               OR (i.summary LIKE '🖼️카드 교환%')`;
    }
    sql += ` )`;

    sql += ' ORDER BY i.createdAt DESC';
    if (limit) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const issues = query(sql, params);
    const formattedIssues = issues.map((issue) => formatIssueRow(issue));

    const total = countCardExchangeIssues({ startDate, endDate, projectId });

    return {
      issues: formattedIssues,
      total,
      limit: effectiveLimit ?? null,
      offset
    };
  } catch (error) {
    logger.error('Failed to get card exchange issues', { error: error.message });
    throw error;
  }
}

/**
 * 카드 교환 이슈 일별 건수 (수집 시각 createdAt → KST 날짜).
 * 관리 > 에이전트 성과의 카드 교환 유입 집계(수집일)와 동일 기준.
 */
function getCardExchangeDailyIngestCounts(options = {}) {
  const { startDate, endDate, projectId } = options;
  if (!startDate || !endDate) {
    return { days: [], total: 0, startDate: startDate || null, endDate: endDate || null };
  }

  try {
    let sql = `SELECT DATE(i.createdAt, '+9 hours') as day, COUNT(*) as count
               FROM ReportItemIssue i
               LEFT JOIN MonitoredBoard mb2 ON i.monitoredBoardId = mb2.id
               WHERE DATE(i.createdAt, '+9 hours') >= ? AND DATE(i.createdAt, '+9 hours') <= ?`;
    const params = [startDate, endDate];

    if (projectId !== undefined && projectId !== null) {
      sql += ' AND i.projectId = ?';
      params.push(projectId);
    }

    const menuMatchCount = sqlCardExchangeFeMenuSourceUrlMatch('i.sourceUrl');
    const boardIdsCount = getCardExchangeMonitoredBoardIdsFromDb();
    sql += ` AND i.monitoredBoardId IS NOT NULL
                  AND mb2.cafeGame = 'PUBG_MOBILE'
                  AND (`;
    if (boardIdsCount.length > 0) {
      const ph2 = boardIdsCount.map(() => '?').join(',');
      sql += ` i.monitoredBoardId IN (${ph2})
                    OR (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatchCount}))
                    OR (i.summary LIKE '🖼️카드 교환%')`;
      params.push(...boardIdsCount);
    } else {
      sql += ` (i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != '' AND (${menuMatchCount}))
                    OR (i.summary LIKE '🖼️카드 교환%')`;
    }
    sql += ` ) GROUP BY day ORDER BY day ASC`;

    const rows = query(sql, params);
    const days = rows.map((r) => ({ date: String(r.day), count: Number(r.count) || 0 }));
    const total = days.reduce((s, d) => s + d.count, 0);

    return { days, total, startDate, endDate };
  } catch (error) {
    logger.error('Failed to get card exchange daily ingest counts', { error: error.message });
    throw error;
  }
}

/** 활성 MonitoredBoard 이슈 건수 — 클랜·카드 교환 목록과 동일 보정 */
function reconcileMonitoredBoardIssueCounts(activeBoards, issueCountByBoardId, options = {}) {
  const { startDate, endDate, projectId, skipClanCardReconciliation } = options;
  const getRaw = (numericId) => {
    if (issueCountByBoardId instanceof Map) {
      const v = issueCountByBoardId.get(numericId);
      return Number(v) || 0;
    }
    const rec = issueCountByBoardId;
    const v = rec[numericId] ?? rec[String(numericId)];
    return Number(v) || 0;
  };
  if (!activeBoards.length) return new Map();

  const boardIds = activeBoards.map((b) => Number(b.id)).filter((id) => !Number.isNaN(id));
  const listByBoard = new Map(boardIds.map((id) => [id, getRaw(id)]));

  /** Full clan/card reconciliation runs COUNT(*) over large WHERE without dates → gateway timeouts on list APIs */
  if (skipClanCardReconciliation) {
    return listByBoard;
  }

  const cardExchangeBoardIds = getCardExchangeMonitoredBoardIdsFromDb();
  const cardExchangeDisplayBoardId = resolveCardExchangeDisplayBoardId(activeBoards, cardExchangeBoardIds);
  const cardDisplayNum =
    cardExchangeDisplayBoardId != null ? Number(cardExchangeDisplayBoardId) : NaN;
  const cardMatchByBoard =
    cardExchangeDisplayBoardId != null && !Number.isNaN(cardDisplayNum)
      ? countCardExchangeMatchesGroupedByMonitoredBoard(boardIds, {
          startDate,
          endDate,
          projectId
        })
      : new Map();
  const cardExchangeListTotal =
    cardExchangeDisplayBoardId != null && !Number.isNaN(cardDisplayNum)
      ? countCardExchangeIssues({ startDate, endDate, projectId })
      : null;

  const clanDisplayBoardId = resolveClanDisplayBoardId(activeBoards);
  const clanDisplayNum = clanDisplayBoardId != null ? Number(clanDisplayBoardId) : NaN;
  const clanMatchByBoard =
    clanDisplayBoardId != null && !Number.isNaN(clanDisplayNum)
      ? countClanMatchesGroupedByMonitoredBoard(boardIds, {
          startDate,
          endDate,
          projectId
        })
      : new Map();
  const clanListTotal =
    clanDisplayBoardId != null && !Number.isNaN(clanDisplayNum)
      ? countClanIssues({ startDate, endDate, projectId })
      : null;

  const out = new Map();
  for (const b of activeBoards) {
    const id = Number(b.id);
    if (Number.isNaN(id)) continue;
    let issueCount = listByBoard.get(id) || 0;
    if (cardExchangeDisplayBoardId != null && !Number.isNaN(cardDisplayNum)) {
      if (id === cardDisplayNum) {
        const rawOnBoard = listByBoard.get(id) || 0;
        const cardOnBoard = cardMatchByBoard.get(id) || 0;
        issueCount = cardExchangeListTotal + Math.max(0, rawOnBoard - cardOnBoard);
      } else {
        issueCount = Math.max(0, issueCount - (cardMatchByBoard.get(id) || 0));
      }
    }
    if (clanDisplayBoardId != null && !Number.isNaN(clanDisplayNum)) {
      if (id === clanDisplayNum) {
        const clanOnBoard = clanMatchByBoard.get(id) || 0;
        issueCount = clanListTotal + Math.max(0, issueCount - clanOnBoard);
      } else {
        issueCount = Math.max(0, issueCount - (clanMatchByBoard.get(id) || 0));
      }
    }
    out.set(id, issueCount);
  }
  return out;
}

/** MonitoredBoard별 이슈 건수 */
function getMonitoredBoardIssueStats(options = {}) {
  const {
    startDate,
    endDate,
    projectId,
    includeInactiveBoards = false,
    boardIds: selectedBoardIds = null
  } = options;

  try {
    let boardSql = 'SELECT id, name, label, cafeGame, projectId, listUrl, url, isActive, enabled FROM MonitoredBoard WHERE 1=1';
    const boardParams = [];
    if (!includeInactiveBoards) {
      boardSql += ' AND isActive = 1 AND enabled = 1';
    }
    if (Array.isArray(selectedBoardIds)) {
      if (selectedBoardIds.length === 0) {
        return {
          boards: [],
          totalIssueCount: 0,
          totalIngestCount: 0,
          range: { startDate: startDate || null, endDate: endDate || null }
        };
      }
      const ph = selectedBoardIds.map(() => '?').join(',');
      boardSql += ` AND id IN (${ph})`;
      boardParams.push(...selectedBoardIds);
    }
    if (projectId !== undefined && projectId !== null) {
      boardSql += ' AND projectId = ?';
      boardParams.push(projectId);
    }
    boardSql += ' ORDER BY cafeGame ASC, name ASC, id ASC';
    const boards = query(boardSql, boardParams);

    const projectIdSet = [...new Set(boards.map((b) => b.projectId).filter((id) => id != null))];
    const projectNameById = {};
    if (projectIdSet.length > 0) {
      const pph = projectIdSet.map(() => '?').join(',');
      const prows = query(`SELECT id, name FROM Project WHERE id IN (${pph})`, projectIdSet);
      prows.forEach((p) => {
        projectNameById[p.id] = p.name;
      });
    }

    if (!boards.length) {
      return {
        boards: [],
        totalIssueCount: 0,
        totalIngestCount: 0,
        range: { startDate: startDate || null, endDate: endDate || null }
      };
    }

    const finalBoardIds = boards.map((b) => b.id);
    const ph = finalBoardIds.map(() => '?').join(',');

    const dateFilter = buildClanIssueDateFilterClause(startDate, endDate);
    let listSql = `SELECT i.monitoredBoardId as boardId, COUNT(*) as count
                   FROM ReportItemIssue i
                   WHERE i.monitoredBoardId IN (${ph})`;
    const listParams = [...finalBoardIds];
    listSql += dateFilter.clause;
    listParams.push(...dateFilter.params);
    if (projectId !== undefined && projectId !== null) {
      listSql += ' AND i.projectId = ?';
      listParams.push(projectId);
    }
    listSql += ' GROUP BY i.monitoredBoardId';
    const listRows = query(listSql, listParams);
    const numericBoardIds = finalBoardIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
    const listByBoard = new Map(numericBoardIds.map((id) => [id, 0]));
    for (const r of listRows) {
      const bid = Number(r.boardId);
      if (!Number.isNaN(bid)) listByBoard.set(bid, Number(r.count) || 0);
    }

    const reconciled = reconcileMonitoredBoardIssueCounts(boards, listByBoard, {
      startDate,
      endDate,
      projectId
    });

    const outBoards = boards.map((b) => {
      const id = b.id;
      const idNum = Number(id);
      const issueCount = Number.isNaN(idNum) ? 0 : reconciled.get(idNum) ?? 0;
      const ingestCount = issueCount;
      const pid = b.projectId != null ? b.projectId : null;
      return {
        id,
        name: (b.name && String(b.name).trim()) || (b.label && String(b.label).trim()) || `게시판 #${id}`,
        cafeGame: b.cafeGame || null,
        projectId: pid,
        projectName: pid != null ? projectNameById[pid] ?? null : null,
        listUrl: b.listUrl || null,
        url: b.url || null,
        issueCount,
        ingestCount
      };
    });

    const totalIssueCount = outBoards.reduce((s, r) => s + r.issueCount, 0);
    const totalIngestCount = outBoards.reduce((s, r) => s + r.ingestCount, 0);

    return {
      boards: outBoards,
      totalIssueCount,
      totalIngestCount,
      range: { startDate: startDate || null, endDate: endDate || null }
    };
  } catch (error) {
    logger.error('Failed to get monitored board issue stats', { error: error.message });
    throw error;
  }
}

/**
 * 클랜 게시글 알림 규칙 체크
 * @param {Object} issue - 이슈 객체
 * @returns {Array} 알림 목록
 */
function checkClanIssueAlerts(issue) {
  const alerts = [];
  const title = issue.summary || '';
  const content = issue.detail || '';
  const fullText = `${title} ${content}`;

  // 1. 제목에 이모지 4개 이상 사용
  // 유니코드 이모지 범위: Emoticons, Miscellaneous Symbols, Dingbats, Transport and Map Symbols, Enclosed characters, Additional emoticons, Symbols and Pictographs, Supplemental Symbols and Pictographs
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]/gu;
  const titleEmojis = title.match(emojiRegex) || [];
  if (titleEmojis.length >= 4) {
    alerts.push({
      type: 'excessive_emojis',
      message: `제목에 이모지 ${titleEmojis.length}개 사용`,
      severity: 'medium'
    });
  }

  // 2. 특수문자·문자로 이모티콘처럼 표현한 경우
  // - 카오모지: (^_^), (^^), (T_T), (-_-) 등
  // - ASCII 이모티콘: :-), :D, ;) 등
  // - 한글 표현: ㅎㅎ, ㅋㅋ, ㅠㅠ, ㅜㅜ (2자 이상, 이모티콘처럼 사용)
  // - 연속 특수문자: ^^, !!!, ~~~ 등
  const emojiLikePatterns = [
    /\(\^[\^_oO\-]*\)/,      // (^^), (^_^), (^o^)
    /\([Tt]_[Tt]\)/,         // (T_T)
    /\(\-[\-_]*\)/,          // (-_-)
    /\([oO]_[oO]\)/,         // (o_o)
    /\([;\'\u3131-\u318E][\_\-]*[;\'\u3131-\u318E]\)/,  // (;_;), (ㅎㅎ)
    /:\-?[\)\]DdPp]/i,      // :-), :), :D, :P
    /;\-?[\)\]]/,           // ;-), ;)
    /\^[\^_]{1,4}(?=[\s,\.!\?]|$)/,  // ^^, ^^^ (공백/구두점/끝 앞)
    /(?:^|[\s,])[ㅎㅋㅠㅜ]{2,}(?=[\s,\.!\?]|$)/,  // ㅎㅎ, ㅋㅋㅋ, ㅠㅠ 등
    /[~!@#$%^&*()_+=\[\]{}|,.<>\/?\-]{3,}/,  // 연속 특수문자 3개 이상
    /[\u2665\u2661\u2728]/,  // ♥, ♡, ✨
  ];

  let hasEmojiLikeExpression = false;
  for (const pattern of emojiLikePatterns) {
    if (pattern.test(title) || pattern.test(content)) {
      hasEmojiLikeExpression = true;
      break;
    }
  }

  if (hasEmojiLikeExpression) {
    alerts.push({
      type: 'special_char_emoticons',
      message: '이모티콘처럼 표현한 특수문자·문자 사용',
      severity: 'medium'
    });
  }

  // 3. 성별 표현 포함
  const genderKeywords = ['여성', '남성', '여자', '남자', '여친', '남친', '여성분', '남성분', '여성회원', '남성회원', '여성만', '남성만', '여성우대', '남성우대'];
  const foundGenderKeywords = genderKeywords.filter(keyword => 
    fullText.includes(keyword)
  );
  if (foundGenderKeywords.length > 0) {
    alerts.push({
      type: 'gender_expression',
      message: `성별 표현 포함: ${foundGenderKeywords.join(', ')}`,
      severity: 'high'
    });
  }

  return alerts;
}

function toRelatedInfo(group, excludeId) {
  const related = group.filter(i => i.id !== excludeId);
  return {
    relatedIssueIds: related.map(i => i.id),
    relatedIssues: related.map(i => ({
      id: i.id,
      summary: (i.summary || '').substring(0, 80),
      sourceUrl: i.sourceUrl || null,
      date: i.date || null,
      createdAt: i.createdAt || null,
      sourceCreatedAt: i.sourceCreatedAt || null
    }))
  };
}

/**
 * 중복 홍보 체크 (같은 날짜 기준)
 * - 제목 정규화(공백 축약) 후 문자열이 완전히 같은 글만 한 그룹
 * - "같은 날"은 원글 일자 우선(i.date → sourceCreatedAt KST → 수집일 KST). 수집일(createdAt)만 쓰면 오늘 수집분이 한날로 몰려 과다 집계됨
 */
function normalizeTitle(summary) {
  return (summary || '').trim().replace(/\s+/g, ' ');
}

/** Asia/Seoul 달력 날짜 YYYY-MM-DD */
function kstCalendarDateFromIso(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  } catch {
    return null;
  }
}

function resolveDuplicatePromotionDayKey(issue) {
  const rawDate = issue.date != null ? String(issue.date).trim() : '';
  if (rawDate) {
    const m = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (issue.sourceCreatedAt) {
    const k = kstCalendarDateFromIso(issue.sourceCreatedAt);
    if (k) return k;
  }
  if (issue.createdAt) {
    const k = kstCalendarDateFromIso(issue.createdAt);
    if (k) return k;
  }
  return null;
}

/** JOIN 등으로 동일 id가 여러 행이면 중복 검사 왜곡 방지 */
function dedupeClanIssueRowsById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const id = row.id;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** 같은 네이버 글(externalPostId)이 이슈에 중복 저장된 경우 홍보 중복으로 치지 않음 */
function dedupeGroupByExternalPostId(group) {
  const seenExt = new Set();
  const out = [];
  for (const issue of group) {
    const ext =
      issue.externalPostId != null && String(issue.externalPostId).trim() !== ''
        ? String(issue.externalPostId).trim()
        : null;
    if (ext) {
      if (seenExt.has(ext)) continue;
      seenExt.add(ext);
    }
    out.push(issue);
  }
  return out;
}

function mergeDuplicateAlertEntry(alertByIssue, issue, group) {
  const { relatedIssueIds, relatedIssues } = toRelatedInfo(group, issue.id);
  alertByIssue[issue.id] = {
    message: `동일 제목 홍보글 ${group.length}건`,
    duplicateCount: group.length,
    relatedIssueIds,
    relatedIssues
  };
}

async function checkDuplicateClanPromotions(issues) {
  const alertByIssue = {}; // issueId -> { message, relatedIssueIds, relatedIssues }

  const issuesByDate = {};
  issues.forEach((issue) => {
    const d = resolveDuplicatePromotionDayKey(issue);
    if (!d) return;
    if (!issuesByDate[d]) issuesByDate[d] = [];
    issuesByDate[d].push(issue);
  });

  Object.keys(issuesByDate).forEach((date) => {
    const dayIssues = issuesByDate[date];
    const titleMap = {};
    dayIssues.forEach((issue) => {
      const key = normalizeTitle(issue.summary);
      if (!key) return;
      if (!titleMap[key]) titleMap[key] = [];
      titleMap[key].push(issue);
    });
    Object.values(titleMap).forEach((rawGroup) => {
      const group = dedupeGroupByExternalPostId(rawGroup);
      if (group.length < 2) return;
      group.forEach((issue) => {
        mergeDuplicateAlertEntry(alertByIssue, issue, group);
      });
    });
  });

  const alerts = Object.entries(alertByIssue).map(([issueId, info]) => ({
    issueId,
    type: 'duplicate_promotion',
    message: info.message,
    severity: 'high',
    duplicateCount: info.duplicateCount,
    relatedIssueIds: info.relatedIssueIds,
    relatedIssues: info.relatedIssues
  }));
  return alerts;
}

/**
 * 동일 출처(externalPostId) 또는 동일 제목(summary)으로 묶인 이슈 그룹 조회
 * - 동일 출처: 같은 네이버 게시글(externalPostId)로 수집된 이슈들 (중복 수집 등)
 * - 동일 제목: 정규화한 제목이 같은 이슈들 (유사 제목 이슈 관리용)
 * @param {Object} options - projectId, startDate, endDate (선택)
 * @returns {Promise<Object>} { groups: [ { keyType, key, count, issues } ] }
 */
async function getSameContentGroups(options = {}) {
  const { projectId, startDate, endDate } = options;
  try {
    let sql = `
      SELECT id, summary, detail, sourceUrl, externalPostId, date, status, projectId,
             source, createdAt, categoryGroupId, categoryId, assignedAgentId
      FROM ReportItemIssue
      WHERE (excludedFromReport = 0 OR excludedFromReport IS NULL)
    `;
    const params = [];
    if (projectId != null && projectId !== '') {
      sql += ' AND (projectId = ? OR projectId IS NULL)';
      params.push(projectId);
    }
    if (startDate) {
      sql += ' AND date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND date <= ?';
      params.push(endDate);
    }
    sql += ' ORDER BY createdAt DESC';
    const issues = query(sql, params);
    if (!Array.isArray(issues) || issues.length === 0) {
      return { groups: [] };
    }

    const normalizeSummary = (s) => {
      if (s == null || typeof s !== 'string') return '';
      return s.trim().replace(/\s+/g, ' ').slice(0, 300);
    };

    const groups = [];
    const seenByExternal = new Set();

    // 1) 동일 출처(externalPostId) 그룹 (2건 이상만)
    const byExternal = new Map();
    for (const issue of issues) {
      const key = issue.externalPostId ? String(issue.externalPostId).trim() : null;
      if (!key) continue;
      if (!byExternal.has(key)) byExternal.set(key, []);
      byExternal.get(key).push(issue);
    }
    for (const [key, list] of byExternal.entries()) {
      if (list.length < 2) continue;
      const issueIds = list.map((i) => i.id);
      issueIds.forEach((id) => seenByExternal.add(id));
      groups.push({
        keyType: 'externalPostId',
        key,
        count: list.length,
        issues: list.map((i) => ({
          id: i.id,
          summary: i.summary,
          detail: i.detail,
          sourceUrl: i.sourceUrl,
          externalPostId: i.externalPostId,
          date: i.date,
          status: i.status,
          source: i.source,
          createdAt: i.createdAt,
          projectId: i.projectId,
          categoryGroupId: i.categoryGroupId,
          categoryId: i.categoryId,
          assignedAgentId: i.assignedAgentId
        }))
      });
    }

    // 2) 동일 제목(summary 정규화) 그룹 (2건 이상, externalPostId 그룹에 포함된 이슈 제외 가능)
    const bySummary = new Map();
    for (const issue of issues) {
      const norm = normalizeSummary(issue.summary);
      if (!norm) continue;
      if (!bySummary.has(norm)) bySummary.set(norm, []);
      bySummary.get(norm).push(issue);
    }
    for (const [key, list] of bySummary.entries()) {
      if (list.length < 2) continue;
      groups.push({
        keyType: 'summary',
        key: key.length > 80 ? key.slice(0, 80) + '…' : key,
        keyFull: key,
        count: list.length,
        issues: list.map((i) => ({
          id: i.id,
          summary: i.summary,
          detail: i.detail,
          sourceUrl: i.sourceUrl,
          externalPostId: i.externalPostId,
          date: i.date,
          status: i.status,
          source: i.source,
          createdAt: i.createdAt,
          projectId: i.projectId,
          categoryGroupId: i.categoryGroupId,
          categoryId: i.categoryId,
          assignedAgentId: i.assignedAgentId
        }))
      });
    }

    return { groups };
  } catch (error) {
    logger.error('getSameContentGroups failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  getAllIssues,
  getGameIssueCounts,
  getIssuesByAgent,
  getCategoryStatistics,
  checkIssue,
  processIssue,
  excludeFromReport,
  updateIssue,
  assignIssue,
  updateIssueStatus,
  getIssueComments,
  addIssueComment,
  getIssueById,
  getIssueDetailForClient,
  getClanIssues,
  getCardExchangeIssues,
  getCardExchangeDailyIngestCounts,
  getMonitoredBoardIssueStats,
  reconcileMonitoredBoardIssueCounts,
  resolveClanDisplayBoardId,
  queryClanIssuesDailyIngestKst,
  checkDuplicateClanPromotions,
  getSameContentGroups,
  ISSUE_STATUSES,
  findAgentIdForUser,
  // test helpers
  normalizePostImagePaths
};
