const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const { parseProjectId, parseIntSafe } = require('../utils/parsers');
const { getBoardListDailySnapshots } = require('../services/boardListDailyCount.service');
const {
  reconcileMonitoredBoardIssueCounts,
  resolveClanDisplayBoardId,
  queryClanIssuesDailyIngestKst
} = require('../services/issues.service');
const { getClanWorkerTargetMonitoredBoardIds } = require('../utils/clanMonitoredBoardIds');
const { getResolvedClanBoardListUrl } = require('../utils/clanBoardListUrl');
const { isValidCrawlerGameCode } = require('../services/crawlerGames.service');

function parseBoardIdsQueryParam(raw) {
  if (raw === undefined || raw === null) return null;
  if (raw === '') return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  return arr
    .map((v) => parseIntSafe(String(v).trim(), undefined))
    .filter((n) => n !== undefined && n !== null && !Number.isNaN(n));
}

/**
 * DB에 저장된 목록(기간) 일별 스냅샷 조회
 * GET /api/monitoring/board-list-daily-snapshots?startDate=&endDate=&projectId=&boardIds=
 */
async function getListDailySnapshots(req, res) {
  try {
    const { startDate, endDate, projectId, boardIds } = req.query;
    if (!startDate || !endDate) {
      return sendError(res, 'startDate와 endDate는 필수입니다 (YYYY-MM-DD)', HTTP_STATUS.BAD_REQUEST);
    }
    const parsedBoardIds = parseBoardIdsQueryParam(boardIds);
    const result = getBoardListDailySnapshots({
      startDate: String(startDate),
      endDate: String(endDate),
      projectId: parseProjectId(projectId),
      boardIds: parsedBoardIds
    });
    sendSuccess(res, result);
  } catch (error) {
    logger.error('[MonitoredBoardsController] getListDailySnapshots failed', { error: error.message });
    sendError(res, '목록 스냅샷 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
}

/**
 * 모니터링 게시판 목록 조회
 * GET /api/monitoring/boards
 */
async function listMonitoredBoards(req, res) {
  try {
    const { isActive, enabled, cafeGame } = req.query;
    
    logger.debug('[MonitoredBoardsController] Listing boards', { isActive, enabled, cafeGame });
    
    let sql = 'SELECT * FROM MonitoredBoard WHERE 1=1';
    const params = [];
    
    if (isActive !== undefined) {
      sql += ' AND isActive = ?';
      params.push(isActive === 'true' ? 1 : 0);
    }
    if (enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }
    if (cafeGame) {
      sql += ' AND cafeGame = ?';
      params.push(cafeGame);
    }
    
    sql += ' ORDER BY isActive DESC, enabled DESC, createdAt DESC';
    
    const boards = query(sql, params);
    
    // 각 게시판의 이슈 개수(ReportItemIssue) 및 수집 글 수(RawLog) 조회
    const boardIds = boards.map(b => b.id);
    const issueCounts = {};
    const rawLogCounts = {};
    if (boardIds.length > 0) {
      const placeholders = boardIds.map(() => '?').join(',');
      const counts = query(
        `SELECT monitoredBoardId, COUNT(*) as count FROM ReportItemIssue WHERE monitoredBoardId IN (${placeholders}) GROUP BY monitoredBoardId`,
        boardIds
      );
      counts.forEach(c => {
        const bid = Number(c.monitoredBoardId);
        if (!Number.isNaN(bid)) issueCounts[bid] = Number(c.count) || 0;
      });
      const rawCounts = query(
        `SELECT boardId, COUNT(*) as count FROM RawLog WHERE source = 'naver' AND boardId IN (${placeholders}) GROUP BY boardId`,
        boardIds
      );
      rawCounts.forEach(c => {
        rawLogCounts[c.boardId] = c.count;
      });
    }

    const activeBoards = boards.filter((b) => !!b.isActive && !!b.enabled);
    // Per-board counts only: skip clan/card merge queries (no date range → very slow on large DB, 504 via proxy)
    const reconciledIssueByBoard =
      activeBoards.length > 0
        ? reconcileMonitoredBoardIssueCounts(activeBoards, issueCounts, { skipClanCardReconciliation: true })
        : new Map();
    
    // 프로젝트 정보 조회
    const projectIds = [...new Set(boards.map(b => b.projectId).filter(Boolean))];
    const projects = {};
    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => '?').join(',');
      const projectList = query(
        `SELECT id, name FROM Project WHERE id IN (${placeholders})`,
        projectIds
      );
      projectList.forEach(p => {
        projects[p.id] = p;
      });
    }
    
    logger.debug('[MonitoredBoardsController] Found boards', { count: boards.length });

    /** naverCafeClan.worker가 MonitoredBoard.lastScanAt 대신 MonitoringConfig에만 기록하는 시각 */
    const clanLastScanByBoardId = {};
    try {
      const clanScanRows = query(
        "SELECT key, value FROM MonitoringConfig WHERE key LIKE 'naverCafeClan.lastScanAt.%'"
      );
      for (const row of clanScanRows || []) {
        const m = String(row.key).match(/^naverCafeClan\.lastScanAt\.(\d+)$/);
        if (!m) continue;
        const boardId = Number(m[1]);
        const raw = row.value;
        if (raw == null || raw === '') continue;
        const d = new Date(String(raw));
        if (!Number.isNaN(d.getTime())) {
          clanLastScanByBoardId[boardId] = d.toISOString();
        }
      }
    } catch (e) {
      logger.warn('[MonitoredBoardsController] Failed to load clan worker lastScanAt map', {
        error: e.message
      });
    }

    let clanWorkerTargetIds = new Set();
    try {
      clanWorkerTargetIds = new Set(getClanWorkerTargetMonitoredBoardIds());
    } catch (e) {
      logger.warn('[MonitoredBoardsController] Failed to resolve clan worker target board ids', {
        error: e.message
      });
    }

    const boardsWithCounts = boards.map((board) => {
      const bid = Number(board.id);
      const issueCount =
        Number.isNaN(bid)
          ? 0
          : board.isActive && board.enabled
            ? reconciledIssueByBoard.get(bid) ?? 0
            : issueCounts[bid] || 0;
      return {
      id: board.id,
      name: board.name || board.label,
      url: board.url || board.listUrl,
      listUrl: board.listUrl,
      cafeGame: board.cafeGame,
      label: board.label,
      enabled: Boolean(board.enabled),
      isActive: Boolean(board.isActive),
      interval: board.interval,
      checkInterval: board.checkInterval || board.interval,
      lastArticleId: board.lastArticleId,
      lastScanAt: board.lastScanAt ? new Date(board.lastScanAt).toISOString() : null,
      lastScanAtClanWorker:
        clanWorkerTargetIds.has(bid) ? (clanLastScanByBoardId[bid] ?? null) : null,
      /** 클랜 워커가 실제로 여는 목록 URL(부모판·전체글 행이어도 menus/178 등으로 보정). UI 안내용 */
      clanWorkerResolvedListUrl:
        clanWorkerTargetIds.has(bid) && !Number.isNaN(bid)
          ? getResolvedClanBoardListUrl(board)
          : null,
      /** naverCafeClan.worker scanAllBoards() 대상 여부(UI 라벨용). 시각은 lastScanAtClanWorker·lastScanAt 조합으로 표시 */
      clanWorkerTarget: !Number.isNaN(bid) && clanWorkerTargetIds.has(bid),
      createdAt: board.createdAt ? new Date(board.createdAt).toISOString() : null,
      updatedAt: board.updatedAt ? new Date(board.updatedAt).toISOString() : null,
      issueCount,
      rawLogCount: rawLogCounts[board.id] || 0,
      projectId: board.projectId || null,
      project: board.projectId && projects[board.projectId] ? {
        id: projects[board.projectId].id,
        name: projects[board.projectId].name
      } : null
    };
    });

    logger.info('[MonitoredBoardsController] Boards listed successfully', { count: boardsWithCounts.length });
    sendSuccess(res, boardsWithCounts);
  } catch (error) {
    logger.error('[MonitoredBoardsController] Failed to list boards', { 
      error: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta
    });
    sendError(res, `게시판 목록 조회 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 모니터링 게시판 생성
 * POST /api/monitoring/boards
 */
async function createMonitoredBoard(req, res) {
  try {
    const { url, name, cafeGame, label, interval, checkInterval, projectId } = req.body;

    logger.info('[MonitoredBoardsController] Creating board', { 
      url: url?.substring(0, 50),
      name,
      cafeGame,
      hasLabel: !!label,
      interval,
      checkInterval
    });

    // 필수 필드 검증
    if (!url || !url.trim()) {
      logger.warn('[MonitoredBoardsController] Missing url');
      return sendError(res, '게시판 URL은 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }

    if (!name || !name.trim()) {
      logger.warn('[MonitoredBoardsController] Missing name');
      return sendError(res, '게시판 이름은 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }

    if (!cafeGame) {
      logger.warn('[MonitoredBoardsController] Missing cafeGame');
      return sendError(res, '카페 게임은 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }

    if (!isValidCrawlerGameCode(cafeGame)) {
      logger.warn('[MonitoredBoardsController] Invalid cafeGame', { cafeGame });
      return sendError(
        res,
        '유효한 네이버 카페 구분(cafeGame)이 아닙니다. 시드의 CRAWLER_GAME 또는 관리 설정을 확인하세요.',
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // listUrl은 url과 동일하게 설정 (중복 방지를 위해)
    const listUrl = url.trim();

    // 중복 URL 체크
    const existing = queryOne('SELECT * FROM MonitoredBoard WHERE listUrl = ?', [listUrl]);
    
    if (existing) {
      logger.warn('[MonitoredBoardsController] Duplicate URL', { listUrl: listUrl.substring(0, 50) });
      return sendError(res, '이미 등록된 게시판 URL입니다', HTTP_STATUS.CONFLICT);
    }

    // projectId 검증 (선택적)
    let finalProjectId = null;
    if (projectId !== undefined && projectId !== null && projectId !== '') {
      finalProjectId = parseInt(projectId, 10);
      if (isNaN(finalProjectId)) {
        return sendError(res, '유효하지 않은 프로젝트 ID', HTTP_STATUS.BAD_REQUEST);
      }
      // 프로젝트 존재 확인
      const project = queryOne('SELECT * FROM Project WHERE id = ?', [finalProjectId]);
      if (!project) {
        return sendError(res, '프로젝트를 찾을 수 없습니다', HTTP_STATUS.BAD_REQUEST);
      }
    }

    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO MonitoredBoard (listUrl, url, name, cafeGame, label, enabled, isActive, interval, checkInterval, projectId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        listUrl,
        url.trim(),
        name.trim(),
        cafeGame,
        label?.trim() || name.trim(),
        1,
        1,
        interval ? parseInt(interval) : 300,
        checkInterval ? parseInt(checkInterval) : (interval ? parseInt(interval) : 300),
        finalProjectId,
        now,
        now
      ]
    );

    const board = queryOne('SELECT * FROM MonitoredBoard WHERE id = ?', [result.lastInsertRowid]);

    logger.info('[MonitoredBoardsController] Board created successfully', { 
      id: board.id, 
      name: board.name,
      url: board.url.substring(0, 50)
    });
    
    sendSuccess(res, board, '게시판이 추가되었습니다');
  } catch (error) {
    logger.error('[MonitoredBoardsController] Failed to create board', { 
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    sendError(res, `게시판 추가 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 모니터링 게시판 수정
 * PATCH /api/monitoring/boards/:id
 */
async function updateMonitoredBoard(req, res) {
  try {
    const { id } = req.params;
    const { url, name, cafeGame, label, enabled, isActive, interval, checkInterval, projectId } = req.body;

    const boardId = parseInt(id, 10);
    if (isNaN(boardId)) {
      return sendError(res, '유효하지 않은 게시판 ID', HTTP_STATUS.BAD_REQUEST);
    }

    // 기존 게시판 확인
    const existing = queryOne('SELECT * FROM MonitoredBoard WHERE id = ?', [boardId]);

    if (!existing) {
      return sendError(res, '게시판을 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    const updateFields = [];
    const params = [];
    
    // URL 변경 시 listUrl도 함께 업데이트
    if (url !== undefined) {
      updateFields.push('url = ?');
      params.push(url);
      updateFields.push('listUrl = ?');
      params.push(url);
    }
    
    if (name !== undefined) {
      updateFields.push('name = ?');
      params.push(name);
    }
    if (label !== undefined) {
      updateFields.push('label = ?');
      params.push(label);
    }
    
    if (cafeGame !== undefined) {
      if (!isValidCrawlerGameCode(cafeGame)) {
        return sendError(
          res,
          '유효한 네이버 카페 구분(cafeGame)이 아닙니다.',
          HTTP_STATUS.BAD_REQUEST
        );
      }
      updateFields.push('cafeGame = ?');
      params.push(cafeGame);
    }
    
    if (enabled !== undefined) {
      updateFields.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }
    if (isActive !== undefined) {
      updateFields.push('isActive = ?');
      params.push(isActive ? 1 : 0);
    }
    
    if (interval !== undefined) {
      updateFields.push('interval = ?');
      params.push(interval);
    }
    if (checkInterval !== undefined) {
      updateFields.push('checkInterval = ?');
      params.push(checkInterval);
    }
    
    // projectId 업데이트
    if (projectId !== undefined) {
      if (projectId === null || projectId === '') {
        updateFields.push('projectId = ?');
        params.push(null);
      } else {
        const parsedProjectId = parseInt(projectId, 10);
        if (isNaN(parsedProjectId)) {
          return sendError(res, '유효하지 않은 프로젝트 ID', HTTP_STATUS.BAD_REQUEST);
        }
        // 프로젝트 존재 확인
        const project = queryOne('SELECT * FROM Project WHERE id = ?', [parsedProjectId]);
        if (!project) {
          return sendError(res, '프로젝트를 찾을 수 없습니다', HTTP_STATUS.BAD_REQUEST);
        }
        updateFields.push('projectId = ?');
        params.push(parsedProjectId);
      }
    }
    
    if (updateFields.length === 0) {
      const board = queryOne('SELECT * FROM MonitoredBoard WHERE id = ?', [boardId]);
      return sendSuccess(res, board, '게시판이 수정되었습니다');
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(boardId);
    
    execute(
      `UPDATE MonitoredBoard SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    const board = queryOne('SELECT * FROM MonitoredBoard WHERE id = ?', [boardId]);
    logger.info('[MonitoredBoardsController] Board updated', { id: board.id });
    sendSuccess(res, board, '게시판이 수정되었습니다');
  } catch (error) {
    logger.error('[MonitoredBoardsController] Failed to update board', { error: error.message });
    sendError(res, '게시판 수정 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 모니터링 게시판 삭제
 * DELETE /api/monitoring/boards/:id
 */
async function deleteMonitoredBoard(req, res) {
  try {
    const { id } = req.params;

    const boardId = parseInt(id, 10);
    if (isNaN(boardId)) {
      return sendError(res, '유효하지 않은 게시판 ID', HTTP_STATUS.BAD_REQUEST);
    }

    // 기존 게시판 확인
    const existing = queryOne('SELECT * FROM MonitoredBoard WHERE id = ?', [boardId]);

    if (!existing) {
      return sendError(res, '게시판을 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    // Hard delete: 실제로 삭제
    execute('DELETE FROM MonitoredBoard WHERE id = ?', [boardId]);

    logger.info('[MonitoredBoardsController] Board deleted', { id: boardId });
    sendSuccess(res, null, '게시판이 삭제되었습니다');
  } catch (error) {
    logger.error('[MonitoredBoardsController] Failed to delete board', { error: error.message });
    sendError(res, '게시판 삭제 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 게시판별 일일 게시글 수 조회
 * - dailyCounts: RawLog.timestamp를 KST 날짜로 묶음 (이미 이슈가 있어 RawLog를 생략한 스캔은 누락될 수 있음)
 * - dailyCountsIssueIngestKst: ReportItemIssue.createdAt KST 일별 (등록·승격 시점, RawLog 생략분 포함)
 * GET /api/monitoring/boards/:id/daily-post-count?startDate=&endDate=
 */
async function getDailyPostCount(req, res) {
  try {
    const boardId = parseInt(req.params.id, 10);
    const { startDate, endDate } = req.query;

    if (isNaN(boardId)) {
      return sendError(res, '유효하지 않은 게시판 ID', HTTP_STATUS.BAD_REQUEST);
    }

    const board = queryOne('SELECT id, name, lastScanAt FROM MonitoredBoard WHERE id = ?', [boardId]);
    if (!board) {
      // 모니터링 UI 특성상 404 대신 "데이터 없음"으로 처리하는 편이 사용성에 유리함
      logger.warn('[MonitoredBoardsController] Board not found for daily-post-count, returning empty result', { boardId });
      return sendSuccess(res, {
        boardId,
        boardName: null,
        lastScanAt: null,
        totalRawLogCount: 0,
        startDate: startDate || null,
        endDate: endDate || null,
        dailyCounts: [],
        dailyCountsIssueIngestKst: []
      });
    }

    // 기간별 일일 건수 (timestamp는 UTC ISO 저장 → 한국 시간(KST) 기준으로 날짜 집계)
    const dateExpr = "DATE(datetime(timestamp, '+9 hours'))";
    let sql = `
      SELECT ${dateExpr} AS date, COUNT(*) AS count
      FROM RawLog
      WHERE source = 'naver' AND boardId = ?
    `;
    const params = [boardId];
    if (startDate) {
      sql += ` AND ${dateExpr} >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND ${dateExpr} <= ?`;
      params.push(endDate);
    }
    sql += ` GROUP BY ${dateExpr} ORDER BY date DESC LIMIT 90`;

    const rows = query(sql, params);

    // 해당 게시판 전체 RawLog 건수 (기간 무관) - "스캔은 했는데 수집 0건" 상황 안내용
    const totalCountRow = queryOne(
      'SELECT COUNT(*) AS total FROM RawLog WHERE source = ? AND boardId = ?',
      ['naver', boardId]
    );
    const totalRawLogCount = totalCountRow ? totalCountRow.total : 0;

    const activeBoards = query(
      'SELECT id, name, label, cafeGame FROM MonitoredBoard WHERE isActive = 1 AND enabled = 1'
    );
    const clanDisplayId = resolveClanDisplayBoardId(activeBoards);
    const isClanDisplayBoard = clanDisplayId != null && Number(clanDisplayId) === boardId;

    let issueRows;
    if (isClanDisplayBoard) {
      issueRows = queryClanIssuesDailyIngestKst({ startDate, endDate });
    } else {
      let issueSql = `
      SELECT DATE(i.createdAt, '+9 hours') AS date, COUNT(*) AS count
      FROM ReportItemIssue i
      WHERE i.monitoredBoardId = ?
    `;
      const issueParams = [boardId];
      if (startDate) {
        issueSql += ` AND DATE(i.createdAt, '+9 hours') >= ?`;
        issueParams.push(startDate);
      }
      if (endDate) {
        issueSql += ` AND DATE(i.createdAt, '+9 hours') <= ?`;
        issueParams.push(endDate);
      }
      issueSql += ` GROUP BY date ORDER BY date DESC LIMIT 90`;
      issueRows = query(issueSql, issueParams);
    }

    sendSuccess(res, {
      boardId,
      boardName: board.name,
      lastScanAt: board.lastScanAt || null,
      totalRawLogCount,
      startDate: startDate || null,
      endDate: endDate || null,
      dailyCounts: rows,
      dailyCountsIssueIngestKst: issueRows
    });
  } catch (error) {
    logger.error('[MonitoredBoardsController] getDailyPostCount failed', { error: error.message });
    sendError(res, '일일 게시글 수 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 목록 기준 일일 게시글 수 (게시판 접속 → 50개씩 목록에서 날짜 셀 파싱 → 같은 날짜 건수 집계)
 * GET /api/monitoring/boards/:id/daily-post-count-from-list?maxPages=10
 */
async function getDailyPostCountFromList(req, res) {
  try {
    const boardId = parseInt(req.params.id, 10);
    const maxPages = Math.min(parseInt(req.query.maxPages, 10) || 10, 20);

    if (isNaN(boardId)) {
      return sendError(res, '유효하지 않은 게시판 ID', HTTP_STATUS.BAD_REQUEST);
    }

    const board = queryOne('SELECT id, name, listUrl, url FROM MonitoredBoard WHERE id = ?', [boardId]);
    if (!board) {
      return sendError(res, '게시판을 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    const listUrl = board.listUrl || board.url;
    if (!listUrl || !listUrl.includes('cafe.naver.com')) {
      return sendError(res, '네이버 카페 목록 URL이 없습니다.', HTTP_STATUS.BAD_REQUEST);
    }

    const {
      fetchDailyCountFromList,
      upsertBoardListDailySnapshots
    } = require('../services/boardListDailyCount.service');
    const { dailyCounts, totalRows } = await fetchDailyCountFromList(listUrl, { maxPages, timeoutMs: 90000 });
    upsertBoardListDailySnapshots(boardId, dailyCounts, { scanTotalRows: totalRows, maxPagesUsed: maxPages });

    sendSuccess(res, {
      boardId,
      boardName: board.name,
      source: 'list',
      totalRows,
      dailyCounts,
      persistedDailyDays: Array.isArray(dailyCounts) ? dailyCounts.length : 0
    });
  } catch (error) {
    logger.error('[MonitoredBoardsController] getDailyPostCountFromList failed', { error: error.message, stack: error.stack });
    const msg = error.message || '목록 기준 게시글 수 조회 실패';
    const isPlaywright = /playwright|chromium|executable|browser/i.test(msg);
    sendError(
      res,
      isPlaywright ? '목록 조회용 브라우저 실행 실패. 서버에 Playwright/Chromium이 설치되어 있는지 확인하세요. (npm run install:playwright)' : msg,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

// 별칭 함수 (호환성을 위해)
const getBoards = listMonitoredBoards;
const createBoard = createMonitoredBoard;
const updateBoard = updateMonitoredBoard;
const deleteBoard = deleteMonitoredBoard;

module.exports = {
  listMonitoredBoards,
  getListDailySnapshots,
  createMonitoredBoard,
  updateMonitoredBoard,
  deleteMonitoredBoard,
  getDailyPostCount,
  getDailyPostCountFromList,
  // 별칭 (호환성)
  getBoards,
  createBoard,
  updateBoard,
  deleteBoard
};
