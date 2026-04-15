/**
 * 업무 체크리스트 서비스
 * - 관리자: 항목 CRUD, 정렬
 * - 에이전트: 날짜별 체크리스트 조회, 실행 여부 체크
 */

const { query, queryOne, execute, tableExists } = require('../libs/db');
const logger = require('../utils/logger');
const { resolveAgentDisplayName } = require('../utils/agentDisplayName');

const WORK_TYPES = ['전체', '주간', '오후', '야간', '정오', 'PC', 'MO'];

function normalizeWorkType(v) {
  if (v == null || v === '') return '전체';
  const s = String(v).trim();
  return WORK_TYPES.includes(s) ? s : '전체';
}

function hasSortByTypeTable() {
  return tableExists('WorkChecklistItemSortByType');
}

/** WorkChecklistItemSortByType 테이블이 없으면 생성 (마이그레이션 미적용 환경 대비) */
function ensureSortByTypeTable() {
  if (hasSortByTypeTable()) return;
  const u = process.env.DATABASE_URL || '';
  if (/^postgres/i.test(u)) {
    logger.warn(
      '[WorkChecklist] WorkChecklistItemSortByType 없음 — backend 에서 `npx prisma migrate deploy` 실행 여부를 확인하세요.'
    );
    return;
  }
  logger.info('[WorkChecklist] Creating WorkChecklistItemSortByType table');
  execute(`
    CREATE TABLE IF NOT EXISTS WorkChecklistItemSortByType (
      workType TEXT NOT NULL,
      itemId INTEGER NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workType, itemId),
      FOREIGN KEY (itemId) REFERENCES WorkChecklistItem(id)
    )
  `);
  execute(`CREATE INDEX IF NOT EXISTS idx_work_checklist_sort_by_type ON WorkChecklistItemSortByType(workType, sortOrder)`);
}

function listItems(options = {}) {
  const { includeInactive = false, workType } = options;
  const wt = workType ? normalizeWorkType(workType) : null;

  let sql = 'SELECT i.* FROM WorkChecklistItem i';
  const params = [];
  const conditions = [];

  if (!includeInactive) {
    conditions.push('i.isActive = 1');
  }

  const useTypeFilter = wt && wt !== '전체';
  if (useTypeFilter) ensureSortByTypeTable();
  const canUseSortByType = useTypeFilter && hasSortByTypeTable();

  if (useTypeFilter) {
    // PC, MO 선택 시: showInPC/showInMO 체크한 항목 또는 workType=PC/MO(구 데이터) 표시
    // 주간·오후·야간·정오: 해당 타입 + workType='전체' 항목 표시
    if (wt === 'PC') {
      conditions.push("(i.workType = 'PC' OR COALESCE(i.showInPC, 0) = 1)");
    } else if (wt === 'MO') {
      conditions.push("(i.workType = 'MO' OR COALESCE(i.showInMO, 0) = 1)");
    } else {
      conditions.push("(i.workType = ? OR i.workType = '전체')");
      params.push(wt);
    }
  } else {
    // "전체" 선택 시: PC, MO 항목은 제외 (각각 PC점검/MO점검에서만 표시)
    conditions.push("(i.workType IS NULL OR i.workType NOT IN ('PC', 'MO'))");
  }

  if (canUseSortByType) {
    sql = `SELECT i.*, COALESCE(s.sortOrder, i.sortOrder) as _typeSortOrder
           FROM WorkChecklistItem i
           LEFT JOIN WorkChecklistItemSortByType s
             ON s.itemId = i.id AND s.workType = ?`;
    // join 조건용 workType 파라미터를 맨 앞에 추가
    params.unshift(wt);
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  if (canUseSortByType) {
    sql += ' ORDER BY _typeSortOrder ASC, i.sortOrder ASC, i.id ASC';
  } else {
    sql += ' ORDER BY i.sortOrder ASC, i.id ASC';
  }

  return query(sql, params);
}

function getItem(id) {
  return queryOne('SELECT * FROM WorkChecklistItem WHERE id = ?', [id]);
}

function normalizeDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseMonthsOfYear(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const nums = s.split(/[\s,]+/).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 12);
  return nums.length ? nums.sort((a, b) => a - b).join(',') : null;
}

function parseDaysOfWeek(v) {
  if (v == null || v === '') return null;
  let parts;
  if (Array.isArray(v)) {
    parts = v;
  } else {
    const s = String(v).trim();
    if (!s) return null;
    parts = s.split(/[\s,]+/);
  }
  const nums = Array.from(
    new Set(
      parts
        .map(n => parseInt(String(n).trim(), 10))
        .filter(n => n >= 1 && n <= 7)
    )
  ).sort((a, b) => a - b);
  return nums.length ? nums.join(',') : null;
}

function createItem(data) {
  const { title, sortOrder = 0, isActive = 1, workType, validFrom, validTo, monthsOfYear, daysOfWeek, url, showInPC, showInMO } = data;
  const wt = normalizeWorkType(workType);
  const vFrom = normalizeDate(validFrom);
  const vTo = normalizeDate(validTo);
  const months = parseMonthsOfYear(monthsOfYear);
  const days = parseDaysOfWeek(daysOfWeek);
  const urlVal = url != null && String(url).trim() !== '' ? String(url).trim() : null;
  const pc = showInPC ? 1 : 0;
  const mo = showInMO ? 1 : 0;
  const maxOrder = queryOne('SELECT COALESCE(MAX(sortOrder), 0) as maxOrder FROM WorkChecklistItem', []);
  const order = sortOrder !== undefined ? sortOrder : (maxOrder?.maxOrder ?? 0) + 1;
  const result = execute(
    `INSERT INTO WorkChecklistItem (title, sortOrder, isActive, workType, validFrom, validTo, monthsOfYear, daysOfWeek, url, showInPC, showInMO, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [String(title).trim(), order, isActive ? 1 : 0, wt, vFrom, vTo, months, days, urlVal, pc, mo]
  );
  return queryOne('SELECT * FROM WorkChecklistItem WHERE id = ?', [result.lastInsertRowid]);
}

function updateItem(id, data) {
  const item = getItem(id);
  if (!item) return null;
  const updates = [];
  const params = [];
  if (data.title !== undefined) {
    updates.push('title = ?');
    params.push(String(data.title).trim());
  }
  if (data.sortOrder !== undefined) {
    updates.push('sortOrder = ?');
    params.push(Number(data.sortOrder));
  }
  if (data.isActive !== undefined) {
    updates.push('isActive = ?');
    params.push(data.isActive ? 1 : 0);
  }
  if (data.workType !== undefined) {
    updates.push('workType = ?');
    params.push(normalizeWorkType(data.workType));
  }
  if (data.validFrom !== undefined) {
    updates.push('validFrom = ?');
    params.push(normalizeDate(data.validFrom));
  }
  if (data.validTo !== undefined) {
    updates.push('validTo = ?');
    params.push(normalizeDate(data.validTo));
  }
  if (data.monthsOfYear !== undefined) {
    updates.push('monthsOfYear = ?');
    params.push(parseMonthsOfYear(data.monthsOfYear));
  }
  if (data.daysOfWeek !== undefined) {
    updates.push('daysOfWeek = ?');
    params.push(parseDaysOfWeek(data.daysOfWeek));
  }
  if (data.url !== undefined) {
    updates.push('url = ?');
    params.push(data.url != null && String(data.url).trim() !== '' ? String(data.url).trim() : null);
  }
  if (data.showInPC !== undefined) {
    updates.push('showInPC = ?');
    params.push(data.showInPC ? 1 : 0);
  }
  if (data.showInMO !== undefined) {
    updates.push('showInMO = ?');
    params.push(data.showInMO ? 1 : 0);
  }
  if (updates.length === 0) return item;
  updates.push("updatedAt = datetime('now')");
  params.push(id);
  execute(
    `UPDATE WorkChecklistItem SET ${updates.join(', ')} WHERE id = ?`,
    params
  );
  return getItem(id);
}

function deleteItem(id) {
  execute('DELETE FROM WorkChecklistExecution WHERE itemId = ?', [id]);
  execute('DELETE FROM WorkChecklistItemSortByType WHERE itemId = ?', [id]);
  const result = execute('DELETE FROM WorkChecklistItem WHERE id = ?', [id]);
  return result.changes > 0;
}

function reorderItems(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
  const db = require('../libs/db').db;
  const transaction = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      execute('UPDATE WorkChecklistItem SET sortOrder = ?, updatedAt = datetime(\'now\') WHERE id = ?', [index, id]);
    });
  });
  transaction();
}

function reorderItemsByType(workType, orderedIds) {
  const wt = normalizeWorkType(workType);
  if (!wt || wt === '전체') return;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
  ensureSortByTypeTable();
  const db = require('../libs/db').db;
  const transaction = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      execute(
        `INSERT INTO WorkChecklistItemSortByType (workType, itemId, sortOrder, updatedAt)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(workType, itemId)
         DO UPDATE SET sortOrder = excluded.sortOrder, updatedAt = datetime('now')`,
        [wt, id, index]
      );
    });
  });
  transaction();
}

function getExecutions(userId, workDate) {
  return query(
    `SELECT * FROM WorkChecklistExecution WHERE userId = ? AND workDate = ?`,
    [userId, workDate]
  );
}

function itemValidForDate(item, workDate) {
  const d = String(workDate).slice(0, 10);
  if (item.validFrom && d < item.validFrom) return false;
  if (item.validTo && d > item.validTo) return false;
  if (item.monthsOfYear && String(item.monthsOfYear).trim()) {
    const month = parseInt(d.slice(5, 7), 10);
    const allowed = String(item.monthsOfYear).split(',').map(n => parseInt(n, 10));
    if (!allowed.includes(month)) return false;
  }
  if (item.daysOfWeek && String(item.daysOfWeek).trim()) {
    const date = new Date(`${d}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      const jsDay = date.getDay(); // 0=일, 1=월, ... 6=토
      const dayNum = jsDay === 0 ? 7 : jsDay; // 1=월 ... 7=일
      const allowedDays = String(item.daysOfWeek)
        .split(',')
        .map(n => parseInt(n.trim(), 10))
        .filter(n => n >= 1 && n <= 7);
      if (allowedDays.length && !allowedDays.includes(dayNum)) return false;
    }
  }
  return true;
}

/**
 * 특정 날짜·작업구분에 에이전트에게 보이는 체크리스트 항목 목록 (실행 기록 없음)
 */
function getApplicableItemsForDate(workDate, workType) {
  let items = listItems({ includeInactive: false, workType: workType || null });
  return items.filter(item => itemValidForDate(item, workDate));
}

function getMyChecklist(userId, workDate, workType) {
  const items = getApplicableItemsForDate(workDate, workType);
  const executions = getExecutions(userId, workDate);
  const byItem = {};
  executions.forEach(e => { byItem[e.itemId] = e; });
  return items.map(item => ({
    ...item,
    isActive: Boolean(item.isActive),
    checked: Boolean(byItem[item.id]?.checked),
    executionId: byItem[item.id]?.id ?? null,
    checkedAt: byItem[item.id]?.checkedAt ?? null
  }));
}

/** AGENT 역할 사용자 목록 (체크리스트 집계용) */
function listAgentUsers() {
  return query(
    `SELECT id, name, email, role FROM User
     WHERE UPPER(COALESCE(role, '')) = 'AGENT'
     ORDER BY COALESCE(name, '') COLLATE NOCASE, email COLLATE NOCASE`
  );
}

/**
 * 해당일·작업 구분에서 체크리스트를 작성해야 하는 담당자 User id 집합
 * (해당일 에이전트 스케줄(AgentSchedule)만 사용 — listAssigneesForDisplay와 동일 기준)
 * 한 명도 없으면 빈 Set → 팀 현황에는 AGENT 전원이 아닌 이 집합만 노출
 */
function getAssigneeUserIdsForOverview(workDate, workType) {
  const date = normalizeDate(workDate);
  if (!date) return new Set();
  const rows = listAssigneesForDisplay(date);
  const ids = new Set();
  const scope =
    workType != null && String(workType).trim() !== ''
      ? normalizeWorkType(workType)
      : '전체';
  if (scope === '전체') {
    for (const row of rows) {
      for (const u of row.users) ids.add(u.id);
    }
  } else {
    const row = rows.find((r) => r.workType === scope);
    if (row) for (const u of row.users) ids.add(u.id);
  }
  return ids;
}

/**
 * 날짜·작업구분별 체크 완료 현황 (팀/관리자 집계)
 * 사용자 목록은 AGENT 전체가 아니라, 해당일·구분의 「체크리스트 작성 담당」만 포함
 * @param {string} workDate YYYY-MM-DD
 * @param {string|null|undefined} workType 주간·PC·MO 등 (에이전트 화면과 동일 규칙)
 */
function getExecutionOverview(workDate, workType) {
  const date = normalizeDate(workDate);
  if (!date) {
    throw new Error('유효한 날짜가 필요합니다. (YYYY-MM-DD)');
  }
  const applicable = getApplicableItemsForDate(date, workType);
  const assigneeIds = getAssigneeUserIdsForOverview(date, workType);
  let agents = listAgentUsers();
  if (assigneeIds.size > 0) {
    agents = agents.filter((a) => assigneeIds.has(a.id));
  } else {
    agents = [];
  }
  const allExec = query(
    'SELECT userId, itemId, checked, checkedAt FROM WorkChecklistExecution WHERE workDate = ?',
    [date]
  );
  const execByUser = {};
  for (const row of allExec) {
    if (!execByUser[row.userId]) execByUser[row.userId] = {};
    execByUser[row.userId][row.itemId] = row;
  }

  const itemSummaries = applicable.map((item) => ({ itemId: item.id, title: item.title }));

  const users = agents.map((agent) => {
    const byItem = execByUser[agent.id] || {};
    let checkedCount = 0;
    const itemStatuses = applicable.map((item) => {
      const ex = byItem[item.id];
      const checked = Boolean(ex?.checked);
      if (checked) checkedCount += 1;
      return {
        itemId: item.id,
        title: item.title,
        checked,
        checkedAt: ex?.checkedAt ?? null
      };
    });
    const total = applicable.length;
    return {
      userId: agent.id,
      name: resolveAgentDisplayName(agent.name, agent.email) || null,
      email: agent.email || null,
      checkedCount,
      totalItems: total,
      allChecked: total > 0 && checkedCount === total,
      itemStatuses
    };
  });

  return {
    workDate: date,
    workType: workType ? normalizeWorkType(workType) : null,
    totalItems: applicable.length,
    items: itemSummaries,
    users
  };
}

function setExecution(userId, itemId, workDate, checked) {
  const item = getItem(itemId);
  if (!item) return null;
  const existing = queryOne(
    'SELECT * FROM WorkChecklistExecution WHERE userId = ? AND itemId = ? AND workDate = ?',
    [userId, itemId, workDate]
  );
  const now = new Date().toISOString();
  if (existing) {
    execute(
      'UPDATE WorkChecklistExecution SET checked = ?, checkedAt = ? WHERE id = ?',
      [checked ? 1 : 0, checked ? now : null, existing.id]
    );
    return queryOne('SELECT * FROM WorkChecklistExecution WHERE id = ?', [existing.id]);
  }
  execute(
    `INSERT INTO WorkChecklistExecution (userId, itemId, workDate, checked, checkedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [userId, itemId, workDate, checked ? 1 : 0, checked ? now : null]
  );
  const last = queryOne('SELECT * FROM WorkChecklistExecution WHERE userId = ? AND itemId = ? AND workDate = ?', [userId, itemId, workDate]);
  return last;
}

/** 체크리스트 상단 알림 배너 테이블 존재 여부 */
function hasBannerTable() {
  const row = queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WorkChecklistBanner'", []);
  return !!row;
}

/** WorkChecklistBanner 테이블 없으면 생성 */
function ensureBannerTable() {
  if (hasBannerTable()) return;
  logger.info('[WorkChecklist] Creating WorkChecklistBanner table');
  execute(`
    CREATE TABLE IF NOT EXISTS WorkChecklistBanner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content TEXT,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  execute("INSERT OR IGNORE INTO WorkChecklistBanner (id, content, updatedAt) VALUES (1, NULL, datetime('now'))");
}

function hasAgentScheduleTable() {
  const row = queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'AgentSchedule'",
    []
  );
  return !!row;
}

/**
 * 에이전트 스케줄(AgentSchedule.workType + 해당일 근무)로 매칭된 User 목록, 작업 구분별
 * Agent.userId가 로그인 User와 연결되어 있어야 하며, 스케줄에 작업 구분이 비어 있으면 제외됩니다.
 */
function getScheduledAgentUsersByDateGrouped(workDate) {
  if (!hasAgentScheduleTable()) return {};
  const date = normalizeDate(workDate);
  if (!date) return {};
  const agentRow = queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Agent'",
    []
  );
  if (!agentRow) return {};
  const d = new Date(`${date}T12:00:00`);
  const dayOfWeek = d.getDay();
  const rows = query(
    `SELECT DISTINCT TRIM(s.workType) AS workType, a.userId AS userId, u.name AS name, u.email AS email
     FROM AgentSchedule s
     JOIN Agent a ON a.id = s.agentId
     JOIN User u ON u.id = a.userId
     WHERE s.isActive = 1
       AND a.userId IS NOT NULL
       AND UPPER(COALESCE(u.role, '')) = 'AGENT'
       AND s.workType IS NOT NULL AND TRIM(s.workType) != ''
       AND (
         (s.scheduleType = 'weekly' AND s.dayOfWeek = ?)
         OR (s.scheduleType = 'specific' AND s.specificDate = ?)
       )`,
    [dayOfWeek, date]
  );
  const byType = {};
  for (const r of rows) {
    const wt = normalizeWorkType(r.workType);
    if (wt === '전체' || !WORK_TYPES.includes(wt)) continue;
    if (!byType[wt]) byType[wt] = [];
    const id = r.userId;
    if (byType[wt].some((u) => u.id === id)) continue;
    byType[wt].push({
      id,
      name: resolveAgentDisplayName(r.name, r.email) || null,
      email: r.email || null
    });
  }
  return byType;
}

function compareUserDisplay(a, b) {
  const an = (a.name || a.email || String(a.id)).toLowerCase();
  const bn = (b.name || b.email || String(b.id)).toLowerCase();
  return an.localeCompare(bn);
}

/**
 * 작업 구분별 담당자 — 해당일 에이전트 스케줄(AgentSchedule)만 사용
 * @param {string|null|undefined} workDateOpt YYYY-MM-DD (필수에 가깝게: 없으면 구분마다 빈 목록)
 * @returns {Array<{ workType: string, users: Array<{id,name,email}>, manualUserIds: number[], scheduleUserIds: number[] }>}
 */
function listAssigneesForDisplay(workDateOpt) {
  const date = normalizeDate(workDateOpt);
  const scheduledByType = date ? getScheduledAgentUsersByDateGrouped(date) : {};
  const out = [];
  for (const wt of WORK_TYPES) {
    if (wt === '전체') continue;
    const scheduledUsers = scheduledByType[wt] || [];
    const scheduleIds = new Set(scheduledUsers.map((u) => u.id));
    const users = [...scheduledUsers].sort(compareUserDisplay);
    out.push({
      workType: wt,
      users,
      manualUserIds: [],
      scheduleUserIds: [...scheduleIds]
    });
  }
  return out;
}

/** 상단 알림글 조회 (에이전트 화면용) */
function getBanner() {
  ensureBannerTable();
  const row = queryOne('SELECT content, updatedAt FROM WorkChecklistBanner WHERE id = 1', []);
  return row ? { content: row.content || '', updatedAt: row.updatedAt || null } : { content: '', updatedAt: null };
}

/** 상단 알림글 저장 (관리자) */
function setBanner(content) {
  ensureBannerTable();
  const now = new Date().toISOString();
  const value = content != null && String(content).trim() !== '' ? String(content).trim() : null;
  execute('UPDATE WorkChecklistBanner SET content = ?, updatedAt = ? WHERE id = 1', [value, now]);
  return getBanner();
}

module.exports = {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  reorderItemsByType,
  getExecutions,
  getMyChecklist,
  getExecutionOverview,
  listAssigneesForDisplay,
  listAgentUsers,
  setExecution,
  getBanner,
  setBanner
};
