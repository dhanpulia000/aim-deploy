// 감사 로그 서비스

const { query, queryOne, execute, safeQuery } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * 감사 로그 생성
 * @param {string} action - 액션 타입 ('LOGIN', 'ISSUE_STATUS_CHANGE', 'SLA_VIOLATION', etc.)
 * @param {number|null} userId - 사용자 ID (선택)
 * @param {object} meta - 추가 메타데이터 (선택)
 * @returns {Promise<Object>} 생성된 감사 로그
 */
async function createAuditLog(action, userId = null, meta = {}) {
  return safeQuery(() => {
    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO AuditLog (action, userId, meta, createdAt) VALUES (?, ?, ?, ?)',
      [
        String(action),
        userId ? Number(userId) : null,
        meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
        now
      ]
    );

    const auditLog = queryOne('SELECT * FROM AuditLog WHERE id = ?', [result.lastInsertRowid]);
    logger.info('Audit log created', { action, userId, auditLogId: auditLog.id });
    return auditLog;
  }, null);
}

/**
 * 감사 로그 조회
 * @param {object} options - 조회 옵션
 * @returns {Promise<Array>} 감사 로그 목록
 */
async function getAuditLogs(options = {}) {
  const {
    userId,
    action,
    startDate,
    endDate,
    limit = 100,
    offset = 0
  } = options;

  return safeQuery(() => {
    let sql = `SELECT a.*, u.id as user_id, u.email as user_email, u.name as user_name 
               FROM AuditLog a
               LEFT JOIN User u ON a.userId = u.id
               WHERE 1=1`;
    const params = [];
    
    if (userId) {
      sql += ' AND a.userId = ?';
      params.push(Number(userId));
    }
    
    if (action) {
      sql += ' AND a.action = ?';
      params.push(String(action));
    }
    
    if (startDate) {
      sql += ' AND a.createdAt >= ?';
      params.push(new Date(startDate).toISOString());
    }
    
    if (endDate) {
      sql += ' AND a.createdAt <= ?';
      params.push(new Date(endDate).toISOString());
    }
    
    sql += ' ORDER BY a.createdAt DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    
    const logs = query(sql, params);
    
    return logs.map(log => ({
      ...log,
      user: log.user_id ? {
        id: log.user_id,
        email: log.user_email,
        name: log.user_name
      } : null
    }));
  }, []);
}

module.exports = {
  createAuditLog,
  getAuditLogs
};
