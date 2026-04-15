/**
 * 데이터베이스 추상화 계층
 * SQLite와 PostgreSQL 모두 지원
 * 자동으로 쿼리를 변환하여 실행
 */

const logger = require('../utils/logger');
const sqliteDb = require('./db');
const postgresDb = require('./db-postgres');

// 현재 데이터베이스 타입 감지
function getDatabaseType() {
  const dbUrl = process.env.DATABASE_URL || process.env.PG_VECTOR_URL || 'file:./prisma/dev.db';
  
  if (dbUrl.startsWith('postgres')) {
    return 'postgres';
  }
  return 'sqlite';
}

// 현재 데이터베이스 타입
const DB_TYPE = getDatabaseType();

/**
 * SQLite 쿼리를 PostgreSQL 쿼리로 변환
 * @param {string} sql - SQLite 쿼리
 * @returns {string} PostgreSQL 쿼리
 */
function convertSqlToPostgres(sql) {
  let converted = sql;
  
  // SQLite DATE 함수를 PostgreSQL로 변환
  // DATE(i.createdAt, '+9 hours') -> (i.createdAt AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::DATE
  converted = converted.replace(
    /DATE\(([^,]+),\s*'\+9\s*hours'\)/gi,
    "(($1 AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::DATE)"
  );
  
  // SQLite의 ? 플레이스홀더는 PostgreSQL에서도 동일하게 사용 가능
  // 하지만 배열 파라미터 처리 필요
  
  // LIMIT/OFFSET은 동일하게 작동
  
  return converted;
}

/**
 * 파라미터를 배열에서 객체로 변환 (PostgreSQL용)
 * @param {Array|Object} params - 파라미터
 * @returns {Array} 배열로 변환된 파라미터
 */
function normalizeParams(params) {
  if (Array.isArray(params)) {
    return params;
  }
  if (typeof params === 'object' && params !== null) {
    return Object.values(params);
  }
  return [];
}

/**
 * SQL 쿼리 실행 (자동 변환)
 * @param {string} sql - SQL 쿼리
 * @param {Array|Object} params - 쿼리 파라미터
 * @returns {Promise<Array>|Array} 실행 결과
 */
function query(sql, params = []) {
  if (DB_TYPE === 'postgres') {
    const convertedSql = convertSqlToPostgres(sql);
    const normalizedParams = normalizeParams(params);
    return postgresDb.query(convertedSql, normalizedParams);
  }
  
  // SQLite는 동기 실행
  return sqliteDb.query(sql, params);
}

/**
 * SQL 쿼리 실행 (단일 행 반환)
 * @param {string} sql - SQL 쿼리
 * @param {Array|Object} params - 쿼리 파라미터
 * @returns {Promise<Object|null>|Object|null} 실행 결과
 */
function queryOne(sql, params = []) {
  if (DB_TYPE === 'postgres') {
    const convertedSql = convertSqlToPostgres(sql);
    const normalizedParams = normalizeParams(params);
    return postgresDb.queryOne(convertedSql, normalizedParams);
  }
  
  return sqliteDb.queryOne(sql, params);
}

/**
 * SQL 실행 (INSERT, UPDATE, DELETE)
 * @param {string} sql - SQL 쿼리
 * @param {Array|Object} params - 쿼리 파라미터
 * @returns {Promise<Object>|Object} 실행 결과
 */
function execute(sql, params = []) {
  if (DB_TYPE === 'postgres') {
    const convertedSql = convertSqlToPostgres(sql);
    const normalizedParams = normalizeParams(params);
    return postgresDb.execute(convertedSql, normalizedParams);
  }
  
  return sqliteDb.execute(sql, params);
}

/**
 * 트랜잭션 실행
 * @param {Function} callback - 트랜잭션 콜백
 * @returns {Promise<*>|*} 트랜잭션 결과
 */
function executeTransaction(callback) {
  if (DB_TYPE === 'postgres') {
    return postgresDb.executeTransaction(callback);
  }
  
  return sqliteDb.executeTransaction(callback);
}

/**
 * 데이터베이스 연결 상태 확인
 * @returns {Promise<boolean>|boolean} 연결 상태
 */
function checkConnection() {
  if (DB_TYPE === 'postgres') {
    return postgresDb.checkConnection();
  }
  
  return sqliteDb.checkConnection();
}

/**
 * 데이터베이스 연결 종료
 * @returns {Promise<void>|void}
 */
function disconnect() {
  if (DB_TYPE === 'postgres') {
    return postgresDb.disconnect();
  }
  
  return sqliteDb.disconnect();
}

/**
 * 데이터베이스 상태 정보
 * @returns {Promise<Object>|Object} 상태 정보
 */
function getStatus() {
  if (DB_TYPE === 'postgres') {
    return postgresDb.getStatus();
  }
  
  return sqliteDb.getStatus();
}

/**
 * 현재 사용 중인 데이터베이스 타입 반환
 * @returns {string} 'sqlite' | 'postgres'
 */
function getCurrentDbType() {
  return DB_TYPE;
}

module.exports = {
  query,
  queryOne,
  execute,
  executeTransaction,
  checkConnection,
  disconnect,
  getStatus,
  getCurrentDbType,
  convertSqlToPostgres, // 테스트용으로 노출
  // 직접 접근 (필요한 경우)
  sqlite: sqliteDb,
  postgres: postgresDb
};
