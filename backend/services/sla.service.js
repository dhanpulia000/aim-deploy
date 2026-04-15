// SLA Policy 서비스

const { query, queryOne, execute, safeQuery } = require('../libs/db');
const logger = require('../utils/logger');
const { toKSTISOString, diffInSeconds } = require('../utils/dateUtils');

/**
 * 프로젝트의 모든 활성 SLA 정책 조회
 * @param {number} projectId - 프로젝트 ID
 * @returns {Promise<Array>} SLA 정책 목록
 */
async function getSlaPolicies(projectId) {
  if (!projectId) {
    throw new Error('Project ID is required');
  }

  return safeQuery(() => {
    return query(
      'SELECT * FROM SlaPolicy WHERE projectId = ? AND isActive = ? ORDER BY createdAt DESC',
      [Number(projectId), 1]
    );
  }, []);
}

/**
 * 모든 SLA 정책 조회 (비활성 포함)
 * @param {number} projectId - 프로젝트 ID
 * @returns {Promise<Array>} SLA 정책 목록
 */
async function getAllSlaPolicies(projectId) {
  if (!projectId) {
    throw new Error('Project ID is required');
  }

  return safeQuery(() => {
    return query(
      'SELECT * FROM SlaPolicy WHERE projectId = ? ORDER BY createdAt DESC',
      [Number(projectId)]
    );
  }, []);
}

/**
 * SLA 정책 생성
 * @param {number} projectId - 프로젝트 ID
 * @param {object} data - SLA 정책 데이터
 * @returns {Promise<Object>} 생성된 SLA 정책
 */
async function createSlaPolicy(projectId, data) {
  if (!projectId) {
    throw new Error('Project ID is required');
  }

  const { severity, responseSec, channel, target, isActive = true } = data;

  if (!severity || !responseSec || !channel || !target) {
    throw new Error('Missing required fields: severity, responseSec, channel, target');
  }

  return safeQuery(() => {
    // 프로젝트 존재 확인
    const project = queryOne('SELECT * FROM Project WHERE id = ?', [Number(projectId)]);

    if (!project) {
      throw new Error('Project not found');
    }

    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO SlaPolicy (projectId, severity, responseSec, channel, target, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        Number(projectId),
        String(severity),
        Number(responseSec),
        String(channel),
        String(target),
        isActive ? 1 : 0,
        now,
        now
      ]
    );

    const policy = queryOne('SELECT * FROM SlaPolicy WHERE id = ?', [result.lastInsertRowid]);
    logger.info('SLA policy created', { policyId: policy.id, projectId, severity });
    return policy;
  }, null);
}

/**
 * SLA 정책 업데이트
 * @param {number} projectId - 프로젝트 ID
 * @param {number} policyId - 정책 ID
 * @param {object} data - 업데이트 데이터
 * @returns {Promise<Object>} 업데이트된 SLA 정책
 */
async function updateSlaPolicy(projectId, policyId, data) {
  if (!projectId || !policyId) {
    throw new Error('Project ID and Policy ID are required');
  }

  return safeQuery(() => {
    // 정책이 해당 프로젝트에 속하는지 확인
    const existing = queryOne(
      'SELECT * FROM SlaPolicy WHERE id = ? AND projectId = ?',
      [Number(policyId), Number(projectId)]
    );

    if (!existing) {
      throw new Error('SLA policy not found');
    }

    const updateFields = [];
    const params = [];
    
    if (data.severity !== undefined) {
      updateFields.push('severity = ?');
      params.push(String(data.severity));
    }
    if (data.responseSec !== undefined) {
      updateFields.push('responseSec = ?');
      params.push(Number(data.responseSec));
    }
    if (data.channel !== undefined) {
      updateFields.push('channel = ?');
      params.push(String(data.channel));
    }
    if (data.target !== undefined) {
      updateFields.push('target = ?');
      params.push(String(data.target));
    }
    if (data.isActive !== undefined) {
      updateFields.push('isActive = ?');
      params.push(data.isActive ? 1 : 0);
    }
    
    if (updateFields.length === 0) {
      return queryOne('SELECT * FROM SlaPolicy WHERE id = ?', [Number(policyId)]);
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(Number(policyId));
    
    execute(
      `UPDATE SlaPolicy SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    const updated = queryOne('SELECT * FROM SlaPolicy WHERE id = ?', [Number(policyId)]);
    logger.info('SLA policy updated', { policyId, projectId });
    return updated;
  }, null);
}

/**
 * SLA 정책 삭제 (soft delete: isActive = false)
 * @param {number} projectId - 프로젝트 ID
 * @param {number} policyId - 정책 ID
 * @returns {Promise<Object>} 업데이트된 SLA 정책
 */
async function deleteSlaPolicy(projectId, policyId) {
  if (!projectId || !policyId) {
    throw new Error('Project ID and Policy ID are required');
  }

  return safeQuery(() => {
    // 정책이 해당 프로젝트에 속하는지 확인
    const existing = queryOne(
      'SELECT * FROM SlaPolicy WHERE id = ? AND projectId = ?',
      [Number(policyId), Number(projectId)]
    );

    if (!existing) {
      throw new Error('SLA policy not found');
    }

    // Soft delete: isActive = false
    const now = new Date().toISOString();
    execute(
      'UPDATE SlaPolicy SET isActive = ?, updatedAt = ? WHERE id = ?',
      [0, now, Number(policyId)]
    );

    const updated = queryOne('SELECT * FROM SlaPolicy WHERE id = ?', [Number(policyId)]);
    logger.info('SLA policy deleted (soft)', { policyId, projectId });
    return updated;
  }, null);
}

/**
 * SLA 위반 체크를 위한 이슈 조회
 * @param {object} policy - SLA 정책
 * @returns {Promise<Array>} SLA 위반 이슈 목록
 */
async function findSlaViolations(policy) {
  if (!policy || !policy.isActive) {
    return [];
  }

  return safeQuery(() => {
    // 한국 시간 기준으로 현재 시간 계산
    const now = new Date();
    const responseSec = policy.responseSec;
    const thresholdTime = new Date(now.getTime() - responseSec * 1000);

    // 심각도 매칭: policy.severity는 문자열이므로 이슈의 severity와 비교
    // sourceCreatedAt이 있으면 원본 작성 시간 기준으로 SLA 계산, 없으면 createdAt 기준
    let sql = `SELECT * FROM ReportItemIssue 
               WHERE projectId = ? 
               AND status IN (?, ?)
               AND COALESCE(sourceCreatedAt, createdAt) < ?
               AND (slaBreachedAt IS NULL OR slaBreachedAt = '')`;
    const params = [
      policy.projectId,
      'OPEN',
      'TRIAGED',
      thresholdTime.toISOString()
    ];
    
    // severity 매칭 (policy.severity가 있으면)
    if (policy.severity) {
      const severityNum = parseInt(policy.severity);
      if (!isNaN(severityNum)) {
        sql += ' AND severity = ?';
        params.push(severityNum);
      }
    }
    
    const issues = query(sql, params);
    return issues;
  }, []);
}

module.exports = {
  getSlaPolicies,
  getAllSlaPolicies,
  createSlaPolicy,
  updateSlaPolicy,
  deleteSlaPolicy,
  findSlaViolations
};
