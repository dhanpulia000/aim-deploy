/**
 * 업무 체크리스트 API 컨트롤러
 * - 관리자: 항목 CRUD, 정렬
 * - 에이전트: 내 체크리스트 조회, 실행 여부 체크
 */

const workChecklistService = require('../services/workChecklist.service');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

function normalizeDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** GET /api/work-checklist/items - 목록 (관리자: includeInactive, workType 필터 가능) */
async function listItems(req, res) {
  try {
    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';
    const workType = req.query.workType ? String(req.query.workType).trim() : null;
    const items = workChecklistService.listItems({ includeInactive, workType: workType || undefined });
    return sendSuccess(res, items);
  } catch (err) {
    logger.error('[WorkChecklist] listItems failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** POST /api/work-checklist/items - 항목 생성 (관리자) */
async function createItem(req, res) {
  try {
    const { title, sortOrder, isActive, workType, validFrom, validTo, monthsOfYear, daysOfWeek, url, showInPC, showInMO } = req.body || {};
    if (!title || !String(title).trim()) {
      return sendError(res, 'title은 필수입니다.', HTTP_STATUS.BAD_REQUEST);
    }
    const item = workChecklistService.createItem({
      title: String(title).trim(),
      sortOrder: sortOrder != null ? Number(sortOrder) : undefined,
      isActive: isActive !== false,
      workType: workType != null ? workType : '전체',
      validFrom: validFrom != null ? validFrom : null,
      validTo: validTo != null ? validTo : null,
      monthsOfYear: monthsOfYear != null ? monthsOfYear : null,
      daysOfWeek: daysOfWeek != null ? daysOfWeek : null,
      url: url != null ? url : null,
      showInPC: !!showInPC,
      showInMO: !!showInMO
    });
    return sendSuccess(res, item, '항목이 추가되었습니다.', HTTP_STATUS.CREATED);
  } catch (err) {
    logger.error('[WorkChecklist] createItem failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** GET /api/work-checklist/items/:id - 항목 단건 (관리자) */
async function getItem(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, '유효하지 않은 ID입니다.', HTTP_STATUS.BAD_REQUEST);
    const item = workChecklistService.getItem(id);
    if (!item) return sendError(res, '항목을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    return sendSuccess(res, item);
  } catch (err) {
    logger.error('[WorkChecklist] getItem failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** PATCH /api/work-checklist/items/:id - 항목 수정 (관리자) */
async function updateItem(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, '유효하지 않은 ID입니다.', HTTP_STATUS.BAD_REQUEST);
    const { title, sortOrder, isActive, workType, validFrom, validTo, monthsOfYear, daysOfWeek, url, showInPC, showInMO } = req.body || {};
    const item = workChecklistService.updateItem(id, {
      ...(title !== undefined && { title: String(title).trim() }),
      ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
      ...(isActive !== undefined && { isActive: !!isActive }),
      ...(workType !== undefined && { workType }),
      ...(validFrom !== undefined && { validFrom }),
      ...(validTo !== undefined && { validTo }),
      ...(monthsOfYear !== undefined && { monthsOfYear }),
      ...(daysOfWeek !== undefined && { daysOfWeek }),
      ...(url !== undefined && { url }),
      ...(showInPC !== undefined && { showInPC: !!showInPC }),
      ...(showInMO !== undefined && { showInMO: !!showInMO })
    });
    if (!item) return sendError(res, '항목을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    return sendSuccess(res, item, '수정되었습니다.');
  } catch (err) {
    logger.error('[WorkChecklist] updateItem failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** DELETE /api/work-checklist/items/:id - 항목 삭제 (관리자) */
async function deleteItem(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, '유효하지 않은 ID입니다.', HTTP_STATUS.BAD_REQUEST);
    const deleted = workChecklistService.deleteItem(id);
    if (!deleted) return sendError(res, '항목을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    return sendSuccess(res, { id }, '삭제되었습니다.');
  } catch (err) {
    logger.error('[WorkChecklist] deleteItem failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** POST /api/work-checklist/items/reorder - 순서 변경 (관리자) */
async function reorderItems(req, res) {
  try {
    const { itemIds, workType } = req.body || {};
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return sendError(res, 'itemIds 배열이 필요합니다.', HTTP_STATUS.BAD_REQUEST);
    }
    if (workType != null && String(workType).trim() && String(workType).trim() !== '전체') {
      return sendError(res, '순서 변경은 "전체" 작업 구분에서만 가능합니다.', HTTP_STATUS.BAD_REQUEST);
    }
    const ids = itemIds.map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n));
    workChecklistService.reorderItems(ids);
    return sendSuccess(res, {}, '순서가 저장되었습니다.');
  } catch (err) {
    logger.error('[WorkChecklist] reorderItems failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** GET /api/work-checklist/banner - 체크리스트 상단 알림글 (에이전트 화면용, 로그인 불필요) */
async function getBanner(req, res) {
  try {
    const banner = workChecklistService.getBanner();
    return sendSuccess(res, banner);
  } catch (err) {
    logger.error('[WorkChecklist] getBanner failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** PATCH /api/work-checklist/banner - 체크리스트 상단 알림글 저장 (관리자) */
async function setBanner(req, res) {
  try {
    const content = req.body?.content != null ? String(req.body.content) : '';
    const banner = workChecklistService.setBanner(content);
    return sendSuccess(res, banner, '알림글이 저장되었습니다.');
  } catch (err) {
    logger.error('[WorkChecklist] setBanner failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** GET /api/work-checklist/executions/overview?date=YYYY-MM-DD&workType=PC — 관리자: 전체 에이전트 체크 현황 */
async function getExecutionOverview(req, res) {
  try {
    const workDate = normalizeDate(req.query.date) || new Date().toISOString().slice(0, 10);
    const workTypeRaw = req.query.workType != null && String(req.query.workType).trim() !== ''
      ? String(req.query.workType).trim()
      : null;
    const overview = workChecklistService.getExecutionOverview(workDate, workTypeRaw);
    return sendSuccess(res, overview);
  } catch (err) {
    logger.error('[WorkChecklist] getExecutionOverview failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.BAD_REQUEST);
  }
}

/** GET /api/work-checklist/executions/team — 로그인 사용자 누구나: 동일 집계(전 에이전트 체크 현황) */
async function getExecutionTeam(req, res) {
  try {
    const workDate = normalizeDate(req.query.date) || new Date().toISOString().slice(0, 10);
    const workTypeRaw = req.query.workType != null && String(req.query.workType).trim() !== ''
      ? String(req.query.workType).trim()
      : null;
    const overview = workChecklistService.getExecutionOverview(workDate, workTypeRaw);
    return sendSuccess(res, overview);
  } catch (err) {
    logger.error('[WorkChecklist] getExecutionTeam failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.BAD_REQUEST);
  }
}

/** GET /api/work-checklist/assignees — 구분별 담당(로그인). ?date=YYYY-MM-DD 에이전트 스케줄(AgentSchedule) 기준 */
async function listAssignees(req, res) {
  try {
    const dateParam =
      req.query.date != null && String(req.query.date).trim() !== ''
        ? String(req.query.date).trim()
        : null;
    const list = workChecklistService.listAssigneesForDisplay(dateParam);
    return sendSuccess(res, list);
  } catch (err) {
    logger.error('[WorkChecklist] listAssignees failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** GET /api/work-checklist/executions - 내 체크리스트 (날짜별, 에이전트) */
async function getMyChecklist(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, '로그인이 필요합니다.', HTTP_STATUS.UNAUTHORIZED);
    const workDate = normalizeDate(req.query.date) || new Date().toISOString().slice(0, 10);
    const workType = req.query.workType ? String(req.query.workType).trim() : null;
    const list = workChecklistService.getMyChecklist(userId, workDate, workType || undefined);
    return sendSuccess(res, { workDate, workType: workType || '전체', items: list });
  } catch (err) {
    logger.error('[WorkChecklist] getMyChecklist failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/** PUT /api/work-checklist/executions - 실행 여부 체크 (에이전트) */
async function setExecution(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, '로그인이 필요합니다.', HTTP_STATUS.UNAUTHORIZED);
    const { itemId, workDate, checked } = req.body || {};
    const itemIdNum = parseInt(itemId, 10);
    if (Number.isNaN(itemIdNum)) return sendError(res, '유효한 itemId가 필요합니다.', HTTP_STATUS.BAD_REQUEST);
    const date = normalizeDate(workDate) || new Date().toISOString().slice(0, 10);
    const execution = workChecklistService.setExecution(userId, itemIdNum, date, !!checked);
    return sendSuccess(res, execution, '저장되었습니다.');
  } catch (err) {
    logger.error('[WorkChecklist] setExecution failed', { error: err.message });
    return sendError(res, err.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  listItems,
  createItem,
  getItem,
  updateItem,
  deleteItem,
  reorderItems,
  getBanner,
  setBanner,
  getExecutionOverview,
  getExecutionTeam,
  listAssignees,
  getMyChecklist,
  setExecution
};
