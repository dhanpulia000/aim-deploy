/**
 * 데이터베이스 초기화 스크립트
 * Prisma 없이 better-sqlite3로 직접 스키마 생성
 */

const fs = require('fs');
const path = require('path');
const { getDatabase } = require('./db');
const logger = require('../utils/logger');

function usePostgres() {
  const u = process.env.DATABASE_URL || '';
  return /^postgres/i.test(u);
}

/** 세미콜론으로 나눈 청크에서 앞쪽의 `--` 주석 줄만 제거 (문 전체를 버리지 않음) */
function stripLeadingLineComments(sqlChunk) {
  const lines = sqlChunk.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('--')) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n').trim();
}

/**
 * 데이터베이스 초기화
 */
function initDatabase() {
  try {
    if (usePostgres()) {
      logger.info(
        '[init-db] Skipping schema.sql for PostgreSQL (apply schema with `npx prisma migrate deploy` in backend/)'
      );
      return true;
    }
    const db = getDatabase();
    const schemaPath = path.join(__dirname, 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // SQL 문을 세미콜론으로 분리하고 실행
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .map(stripLeadingLineComments)
      .filter(s => s.length > 0);
    
    logger.info('Initializing database schema...', { statementCount: statements.length });
    
    // 트랜잭션으로 실행
    const transaction = db.transaction(() => {
      for (const statement of statements) {
        try {
          db.exec(statement);
        } catch (error) {
          // 일부 문장은 이미 존재할 수 있으므로 무시
          if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
            logger.warn('Schema statement failed (may already exist)', {
              statement: statement.substring(0, 100),
              error: error.message
            });
          }
        }
      }
    });
    
    transaction();
    
    logger.info('Database schema initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize database', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * 데이터베이스 마이그레이션 체크
 */
function checkMigrations() {
  try {
    if (usePostgres()) return [];
    const db = getDatabase();
    
    // 마이그레이션 테이블이 없으면 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 적용된 마이그레이션 조회
    const migrations = db.prepare('SELECT name FROM _migrations ORDER BY appliedAt ASC').all();
    return migrations.map(m => m.name);
  } catch (error) {
    logger.error('Failed to check migrations', { error: error.message });
    return [];
  }
}

/**
 * 마이그레이션 적용
 */
function applyMigration(name, sql) {
  try {
    if (usePostgres()) {
      logger.debug('[init-db] Skipping SQLite migration file for PostgreSQL', { name });
      return false;
    }
    const db = getDatabase();
    const applied = checkMigrations();
    
    if (applied.includes(name)) {
      logger.info('Migration already applied', { name });
      return false;
    }
    
    const transaction = db.transaction(() => {
      // SQL 실행
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .map(stripLeadingLineComments)
        .filter(s => s.length > 0);
      
      for (const statement of statements) {
        db.exec(statement);
      }
      
      // 마이그레이션 기록
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
    });
    
    transaction();
    
    logger.info('Migration applied successfully', { name });
    return true;
  } catch (error) {
    logger.error('Failed to apply migration', {
      name,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

if (require.main === module) {
  // 직접 실행 시 초기화
  initDatabase();
  logger.info('Database initialization complete');
}

module.exports = {
  initDatabase,
  checkMigrations,
  applyMigration
};

