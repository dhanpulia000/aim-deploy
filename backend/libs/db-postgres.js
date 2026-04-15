/**
 * PostgreSQL 데이터베이스 연결 및 쿼리 헬퍼
 * pgvector 확장 사용
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

// PostgreSQL 연결 풀 싱글톤
let pool = null;

/**
 * PostgreSQL 연결 풀 생성
 * @returns {Pool} PostgreSQL 연결 풀
 */
function getPool() {
  if (!pool) {
    const connectionString = process.env.PG_VECTOR_URL || process.env.DATABASE_URL;
    
    if (!connectionString || !connectionString.startsWith('postgres')) {
      logger.warn('[PostgreSQL] Connection string not configured or not PostgreSQL format');
      return null;
    }
    
    try {
      pool = new Pool({
        connectionString,
        max: 20, // 최대 연결 수
        idleTimeoutMillis: 30000, // 유휴 연결 타임아웃
        connectionTimeoutMillis: 5000, // 연결 타임아웃
      });
      
      // 연결 에러 핸들링
      pool.on('error', (err) => {
        logger.error('[PostgreSQL] Unexpected error on idle client', {
          error: err.message,
          stack: err.stack
        });
      });
      
      logger.info('[PostgreSQL] Connection pool created', {
        max: 20,
        hasPgVectorUrl: !!process.env.PG_VECTOR_URL
      });
      
      // pgvector 확장 확인 (비동기, 에러는 무시)
      checkPgVectorExtension().catch(err => {
        logger.debug('[PostgreSQL] pgvector check failed (non-critical)', {
          error: err.message
        });
      });
    } catch (error) {
      logger.error('[PostgreSQL] Failed to create connection pool', {
        error: error.message
      });
      throw error;
    }
  }
  
  return pool;
}

/**
 * pgvector 확장 설치 여부 확인
 */
async function checkPgVectorExtension() {
  try {
    const p = getPool();
    if (!p) return;
    
    const result = await p.query(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as exists"
    );
    
    if (!result.rows[0]?.exists) {
      logger.warn('[PostgreSQL] pgvector extension not installed. Please run: CREATE EXTENSION vector;');
    } else {
      logger.info('[PostgreSQL] pgvector extension is available');
    }
  } catch (error) {
    logger.warn('[PostgreSQL] Failed to check pgvector extension', {
      error: error.message
    });
  }
}

/**
 * 데이터베이스 연결 상태 확인
 * @returns {Promise<boolean>} 연결 상태
 */
async function checkConnection() {
  try {
    const p = getPool();
    if (!p) return false;
    
    await p.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('[PostgreSQL] Connection check failed', {
      error: error.message
    });
    return false;
  }
}

/**
 * SQL 쿼리 실행
 * @param {string} sql - SQL 쿼리
 * @param {Array} params - 쿼리 파라미터
 * @returns {Promise<Array>} 실행 결과
 */
async function query(sql, params = []) {
  try {
    const p = getPool();
    if (!p) {
      throw new Error('PostgreSQL connection pool not available');
    }
    
    const result = await p.query(sql, params);
    return result.rows;
  } catch (error) {
    logger.error('[PostgreSQL] Query execution failed', {
      error: error.message,
      sql: sql.substring(0, 200),
      params: params.length
    });
    throw error;
  }
}

/**
 * SQL 쿼리 실행 (단일 행 반환)
 * @param {string} sql - SQL 쿼리
 * @param {Array} params - 쿼리 파라미터
 * @returns {Promise<Object|null>} 실행 결과 (단일 행)
 */
async function queryOne(sql, params = []) {
  try {
    const rows = await query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logger.error('[PostgreSQL] QueryOne execution failed', {
      error: error.message,
      sql: sql.substring(0, 200)
    });
    throw error;
  }
}

/**
 * SQL 실행 (INSERT, UPDATE, DELETE)
 * @param {string} sql - SQL 쿼리
 * @param {Array} params - 쿼리 파라미터
 * @returns {Promise<Object>} 실행 결과
 */
async function execute(sql, params = []) {
  try {
    const p = getPool();
    if (!p) {
      throw new Error('PostgreSQL connection pool not available');
    }
    
    const result = await p.query(sql, params);
    return {
      lastInsertRowid: result.rows[0]?.id || null,
      changes: result.rowCount || 0
    };
  } catch (error) {
    logger.error('[PostgreSQL] Execute failed', {
      error: error.message,
      sql: sql.substring(0, 200)
    });
    throw error;
  }
}

/**
 * 트랜잭션 실행
 * @param {Function} callback - 트랜잭션 콜백 함수 (client를 받음)
 * @returns {Promise<*>} 트랜잭션 결과
 */
async function executeTransaction(callback) {
  const p = getPool();
  if (!p) {
    throw new Error('PostgreSQL connection pool not available');
  }
  
  const client = await p.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[PostgreSQL] Transaction failed', {
      error: error.message
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 데이터베이스 연결 종료
 */
async function disconnect() {
  try {
    if (pool) {
      await pool.end();
      pool = null;
      logger.info('[PostgreSQL] Connection pool closed');
    }
  } catch (error) {
    logger.error('[PostgreSQL] Failed to close connection pool', {
      error: error.message
    });
  }
}

/**
 * 데이터베이스 상태 정보
 * @returns {Promise<Object>} 데이터베이스 상태
 */
async function getStatus() {
  try {
    const isConnected = await checkConnection();
    
    return {
      connected: isConnected,
      type: 'postgresql',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      connected: false,
      type: 'postgresql',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  getPool,
  checkConnection,
  query,
  queryOne,
  execute,
  executeTransaction,
  disconnect,
  getStatus,
  checkPgVectorExtension
};
