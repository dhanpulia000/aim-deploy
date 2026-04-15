const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

const SEVERITY_KEYWORD_MAP = {
  CRITICAL: 1,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
};

function normalizeProjectId(projectId) {
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    throw new Error('Valid projectId is required');
  }
  return id;
}

function toSeverityNumber(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }
  const mapped = SEVERITY_KEYWORD_MAP[(String(value) || '').toUpperCase()];
  return mapped;
}

function textMatchesRule(keyword, summary = '', detail = '') {
  if (!keyword) return false;
  const lowered = keyword.toLowerCase().trim();
  if (!lowered) return false;
  const haystack = `${summary || ''} ${detail || ''}`.toLowerCase();
  return haystack.includes(lowered);
}

function applyRules(rules, summary, detail, fallbackCategory, fallbackSeverity) {
  if (!rules || !rules.length) {
    return { category: fallbackCategory, severity: fallbackSeverity };
  }

  const match = rules.find((rule) => textMatchesRule(rule.keyword, summary, detail));
  if (!match) {
    return { category: fallbackCategory, severity: fallbackSeverity };
  }

  const matchedSeverity = toSeverityNumber(match.severity);
  return {
    category: match.category || fallbackCategory,
    severity: matchedSeverity ?? fallbackSeverity
  };
}

async function listRules(projectId) {
  const id = normalizeProjectId(projectId);
  return query(
    'SELECT * FROM ClassificationRule WHERE projectId = ? ORDER BY createdAt ASC',
    [id]
  );
}

async function createRule(projectId, payload) {
  const id = normalizeProjectId(projectId);
  const now = new Date().toISOString();
  
  const result = execute(
    'INSERT INTO ClassificationRule (projectId, keyword, category, severity, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      payload.keyword,
      payload.category || '기타',
      payload.severity || '3',
      payload.isActive !== undefined ? (payload.isActive ? 1 : 0) : 1,
      now,
      now
    ]
  );
  
  return queryOne('SELECT * FROM ClassificationRule WHERE id = ?', [result.lastInsertRowid]);
}

async function updateRule(projectId, ruleId, payload) {
  const id = normalizeProjectId(projectId);
  const numericRuleId = Number(ruleId);
  if (Number.isNaN(numericRuleId)) {
    throw new Error('Valid rule id is required');
  }

  const existing = queryOne(
    'SELECT * FROM ClassificationRule WHERE id = ? AND projectId = ?',
    [numericRuleId, id]
  );

  if (!existing) {
    throw new Error('Rule not found for this project');
  }

  const updateFields = [];
  const params = [];
  
  if (payload.keyword !== undefined) {
    updateFields.push('keyword = ?');
    params.push(payload.keyword);
  }
  if (payload.category !== undefined) {
    updateFields.push('category = ?');
    params.push(payload.category);
  }
  if (payload.severity !== undefined) {
    updateFields.push('severity = ?');
    params.push(payload.severity);
  }
  if (payload.isActive !== undefined) {
    updateFields.push('isActive = ?');
    params.push(payload.isActive ? 1 : 0);
  }
  
  if (updateFields.length === 0) {
    return queryOne('SELECT * FROM ClassificationRule WHERE id = ?', [numericRuleId]);
  }
  
  updateFields.push('updatedAt = ?');
  params.push(new Date().toISOString());
  params.push(numericRuleId);
  
  execute(
    `UPDATE ClassificationRule SET ${updateFields.join(', ')} WHERE id = ?`,
    params
  );
  
  return queryOne('SELECT * FROM ClassificationRule WHERE id = ?', [numericRuleId]);
}

async function deleteRule(projectId, ruleId) {
  const id = normalizeProjectId(projectId);
  const numericRuleId = Number(ruleId);
  if (Number.isNaN(numericRuleId)) {
    throw new Error('Valid rule id is required');
  }

  const existing = queryOne(
    'SELECT * FROM ClassificationRule WHERE id = ? AND projectId = ?',
    [numericRuleId, id]
  );

  if (!existing) {
    throw new Error('Rule not found for this project');
  }

  execute('DELETE FROM ClassificationRule WHERE id = ?', [numericRuleId]);

  return true;
}

async function loadActiveRules(projectId) {
  if (!projectId) return [];
  const id = normalizeProjectId(projectId);
  return query(
    'SELECT * FROM ClassificationRule WHERE projectId = ? AND isActive = ? ORDER BY createdAt ASC',
    [id, 1]
  );
}

async function applyClassificationRules(projectId, issuePayload) {
  if (!projectId) {
    return {
      category: issuePayload.category,
      severity: issuePayload.severity
    };
  }

  const rules = await loadActiveRules(projectId);
  return applyRules(
    rules,
    issuePayload.summary,
    issuePayload.detail,
    issuePayload.category,
    issuePayload.severity
  );
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  loadActiveRules,
  applyRules,
  applyClassificationRules
};
