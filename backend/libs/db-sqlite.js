// 데이터베이스 관련 라이브러리 - better-sqlite3 직접 사용

const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../utils/logger');

// 데이터베이스 연결 싱글톤
let cachedDb = null;
let cachedDatabaseUrl = null;
let maintenanceStarted = false;

/** WAL을 메인 파일에 반영하고 -wal을 정리( TRUNCATE ). 종료·연결 교체 직전에 호출 */
function checkpointWalTruncate(db) {
  if (!db) return;
  try {
    const mode = db.pragma('journal_mode', { simple: true });
    if (String(mode).toLowerCase() === 'wal') {
      db.pragma('wal_checkpoint(TRUNCATE)');
    }
  } catch (err) {
    logger.warn('WAL checkpoint failed', { error: err.message });
  }
}

function checkpointWalPassive(db) {
  if (!db) return;
  try {
    const mode = db.pragma('journal_mode', { simple: true });
    if (String(mode).toLowerCase() === 'wal') {
      db.pragma('wal_checkpoint(PASSIVE)');
    }
  } catch (err) {
    logger.warn('WAL passive checkpoint failed', { error: err.message });
  }
}

function runStartupQuickCheck(db) {
  const rows = db.pragma('quick_check');
  const failed = rows.filter((r) => {
    const v = r.quick_check != null ? r.quick_check : Object.values(r)[0];
    return String(v).toLowerCase() !== 'ok';
  });
  if (failed.length) {
    logger.error('SQLite PRAGMA quick_check failed', { failed });
    throw new Error('SQLite database failed quick_check; restore from backup or run integrity diagnostics.');
  }
  logger.info('SQLite quick_check passed');
}

function startSqliteMaintenance(db) {
  if (!db || maintenanceStarted) return;
  maintenanceStarted = true;

  const intervalMsRaw = process.env.SQLITE_WAL_CHECKPOINT_INTERVAL_MS;
  const intervalMs = Number(intervalMsRaw ?? 120000);
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs >= 10000 ? intervalMs : 120000;

  const timer = setInterval(() => checkpointWalPassive(db), safeIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  const shutdown = () => {
    try {
      checkpointWalTruncate(db);
    } catch (e) {
      // no-op
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('beforeExit', shutdown);
}

/**
 * 데이터베이스 연결 생성
 * @returns {Database} SQLite 데이터베이스 인스턴스
 */
function getDatabase() {
  const currentDatabaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
  
  // 데이터베이스 URL이 변경되었거나 DB 인스턴스가 없으면 재생성
  if (!cachedDb || cachedDatabaseUrl !== currentDatabaseUrl) {
    if (cachedDb) {
      // 기존 연결 종료
      try {
        checkpointWalTruncate(cachedDb);
        cachedDb.close();
      } catch (err) {
        logger.warn('Failed to close existing database connection', { error: err.message });
      }
    }
    
    // SQLite 파일 경로 추출 (file:./prisma/dev.db -> ./prisma/dev.db)
    let dbPath = currentDatabaseUrl;
    if (dbPath.startsWith('file:')) {
      dbPath = dbPath.replace(/^file:/, '');
    }
    
    // 절대 경로로 변환
    if (!path.isAbsolute(dbPath)) {
      dbPath = path.resolve(__dirname, '..', dbPath);
    }
    
    try {
      // timeout: BUSY 시 대기 시간(ms). 여러 워커 동시 접근 시 SQLITE_BUSY 완화
      cachedDb = new Database(dbPath, { timeout: 30000 });
      
      // WAL 모드 설정 (동시성 처리 최적화)
      cachedDb.pragma('journal_mode = WAL');
      cachedDb.pragma('busy_timeout = 30000');
      // WAL 안정성/성능 밸런스 (WAL 손상 위험을 "0"으로 만들 수는 없지만, 급작스런 종료 시 영향 범위를 줄임)
      cachedDb.pragma('synchronous = NORMAL');
      cachedDb.pragma('temp_store = MEMORY');
      // 과도한 WAL 성장 방지(페이지 단위). 1000 pages ≈ 4MB (page_size 4096 기준)
      cachedDb.pragma('wal_autocheckpoint = 1000');
      
      // 외래 키 제약 조건 활성화
      cachedDb.pragma('foreign_keys = ON');

      if (
        process.env.SQLITE_STARTUP_QUICK_CHECK === '1' ||
        process.env.SQLITE_STARTUP_QUICK_CHECK === 'true'
      ) {
        runStartupQuickCheck(cachedDb);
      }

      startSqliteMaintenance(cachedDb);
      
      cachedDatabaseUrl = currentDatabaseUrl;
      
      logger.info('Database connection initialized', { databasePath: dbPath });
    } catch (error) {
      logger.error('Failed to initialize database', { error: error.message, path: dbPath });
      throw error;
    }
  }
  
  return cachedDb;
}

const db = getDatabase();

/**
 * 데이터베이스 연결 상태 확인
 * @returns {boolean} 연결 상태
 */
function checkConnection() {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch (error) {
    logger.error('Database connection check failed', { error: error.message });
    return false;
  }
}

/**
 * 트랜잭션 실행
 * @param {Function} callback - 트랜잭션 콜백 함수 (transaction 객체를 받음)
 * @returns {*} 트랜잭션 결과
 */
function executeTransaction(callback) {
  const transaction = db.transaction(callback);
  try {
    return transaction();
  } catch (error) {
    logger.error('Transaction failed', { error: error.message });
    throw error;
  }
}

/**
 * 안전한 데이터베이스 쿼리 실행
 * @param {Function} queryFn - 쿼리 함수
 * @param {*} defaultValue - 실패 시 기본값
 * @returns {*} 쿼리 결과 또는 기본값
 */
function safeQuery(queryFn, defaultValue = null) {
  try {
    return queryFn();
  } catch (error) {
    logger.error('Database query failed', { error: error.message });
    return defaultValue;
  }
}

/**
 * 페이지네이션 쿼리 실행
 * @param {string} tableName - 테이블 이름
 * @param {Object} options - 쿼리 옵션
 * @returns {Object} 페이지네이션된 결과
 */
function paginatedQuery(tableName, options = {}) {
  const {
    where = '',
    orderBy = '',
    page = 1,
    limit = 10,
    params = {}
  } = options;
  
  const skip = (page - 1) * limit;
  
  try {
    // 데이터 조회
    let dataQuery = `SELECT * FROM ${tableName}`;
    if (where) {
      dataQuery += ` WHERE ${where}`;
    }
    if (orderBy) {
      dataQuery += ` ORDER BY ${orderBy}`;
    }
    dataQuery += ` LIMIT ? OFFSET ?`;
    
    const dataStmt = db.prepare(dataQuery);
    const data = dataStmt.all({ ...params, limit, skip });
    
    // 전체 개수 조회
    let countQuery = `SELECT COUNT(*) as total FROM ${tableName}`;
    if (where) {
      countQuery += ` WHERE ${where}`;
    }
    const countStmt = db.prepare(countQuery);
    const { total } = countStmt.get(params);
    
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Paginated query failed', { error: error.message, table: tableName });
    throw error;
  }
}

/**
 * 데이터베이스 연결 종료
 */
function disconnect() {
  try {
    if (cachedDb) {
      checkpointWalTruncate(cachedDb);
      cachedDb.close();
      cachedDb = null;
      cachedDatabaseUrl = null;
      logger.info('Database disconnected');
    }
  } catch (error) {
    logger.error('Database disconnect failed', { error: error.message });
  }
}

/**
 * 데이터베이스 상태 정보
 * @returns {Object} 데이터베이스 상태
 */
function getStatus() {
  try {
    const isConnected = checkConnection();
    
    return {
      connected: isConnected,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * SQL 쿼리 실행 헬퍼
 * @param {string} sql - SQL 쿼리 (파라미터는 ? 또는 :name 형식)
 * @param {Object|Array} params - 쿼리 파라미터 (객체 또는 배열)
 * @returns {Array} 실행 결과
 */
function query(sql, params = {}) {
  try {
    const stmt = db.prepare(sql);
    // better-sqlite3는 배열 또는 객체를 받음
    const paramArray = Array.isArray(params) ? params : Object.values(params);
    return stmt.all(...paramArray);
  } catch (error) {
    logger.error('Query execution failed', { error: error.message, sql, params });
    throw error;
  }
}

/**
 * SQL 쿼리 실행 (단일 행 반환)
 * @param {string} sql - SQL 쿼리 (파라미터는 ? 또는 :name 형식)
 * @param {Object|Array} params - 쿼리 파라미터 (객체 또는 배열)
 * @returns {Object|null} 실행 결과 (단일 행)
 */
function queryOne(sql, params = {}) {
  try {
    const stmt = db.prepare(sql);
    // better-sqlite3는 배열 또는 객체를 받음
    const paramArray = Array.isArray(params) ? params : Object.values(params);
    return stmt.get(...paramArray) || null;
  } catch (error) {
    logger.error('Query execution failed', { error: error.message, sql, params });
    throw error;
  }
}

/**
 * SQL 실행 (INSERT, UPDATE, DELETE)
 * @param {string} sql - SQL 쿼리 (파라미터는 ? 또는 :name 형식)
 * @param {Object|Array} params - 쿼리 파라미터 (객체 또는 배열)
 * @returns {Object} 실행 결과
 */
function execute(sql, params = {}) {
  try {
    const stmt = db.prepare(sql);
    // better-sqlite3는 배열 또는 객체를 받음
    const paramArray = Array.isArray(params) ? params : Object.values(params);
    const result = stmt.run(...paramArray);
    return {
      lastInsertRowid: result.lastInsertRowid,
      changes: result.changes
    };
  } catch (error) {
    logger.error('Execute failed', { error: error.message, sql, params });
    throw error;
  }
}

function tableExists(name) {
  try {
    const row = queryOne(
      "SELECT 1 as x FROM sqlite_master WHERE type='table' AND name = ?",
      [name]
    );
    return !!row;
  } catch {
    return false;
  }
}

module.exports = {
  db,
  getDatabase,
  checkConnection,
  executeTransaction,
  safeQuery,
  paginatedQuery,
  disconnect,
  getStatus,
  query,
  queryOne,
  execute,
  tableExists
};
