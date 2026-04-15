/**
 * PostgreSQL + pgvector 초기화 스크립트
 * 실행 방법: node scripts/init-pgvector.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { query, execute } = require('../libs/db-postgres');

async function initPgVector() {
  try {
    logger.info('[InitPgVector] Starting initialization...');

    // 1. PostgreSQL 연결 확인
    const pool = require('../libs/db-postgres').getPool();
    if (!pool) {
      logger.error('[InitPgVector] PostgreSQL connection pool not available');
      logger.info('[InitPgVector] Please set PG_VECTOR_URL environment variable');
      process.exit(1);
    }

    // 2. pgvector 확장 설치
    logger.info('[InitPgVector] Installing pgvector extension...');
    try {
      await execute('CREATE EXTENSION IF NOT EXISTS vector');
      logger.info('[InitPgVector] pgvector extension installed');
    } catch (error) {
      if (error.message.includes('permission denied')) {
        logger.error('[InitPgVector] Permission denied. Please run as superuser:');
        logger.info('[InitPgVector] psql -U postgres -d your_database -c "CREATE EXTENSION vector;"');
        process.exit(1);
      }
      throw error;
    }

    // 3. 테이블 생성
    logger.info('[InitPgVector] Creating tables...');
    await execute(`
      CREATE TABLE IF NOT EXISTS issue_embeddings (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        embedding vector(1536),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(issue_id)
      )
    `);

    // 4. 인덱스 생성
    logger.info('[InitPgVector] Creating indexes...');
    try {
      await execute(`
        CREATE INDEX IF NOT EXISTS issue_embeddings_vector_idx 
        ON issue_embeddings 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);
    } catch (error) {
      logger.warn('[InitPgVector] Failed to create vector index (may already exist)', {
        error: error.message
      });
    }

    await execute(`
      CREATE INDEX IF NOT EXISTS issue_embeddings_issue_id_idx 
      ON issue_embeddings(issue_id)
    `);

    // 5. 확인
    logger.info('[InitPgVector] Verifying installation...');
    const extensionCheck = await query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'"
    );

    if (extensionCheck.length > 0) {
      logger.info('[InitPgVector] pgvector extension verified', {
        name: extensionCheck[0].extname,
        version: extensionCheck[0].extversion
      });
    } else {
      logger.warn('[InitPgVector] pgvector extension not found');
    }

    const tableCheck = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'issue_embeddings'
    `);

    logger.info('[InitPgVector] Tables created', {
      columns: tableCheck.map(c => ({ name: c.column_name, type: c.data_type }))
    });

    logger.info('[InitPgVector] Initialization completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('[InitPgVector] Initialization failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// 실행
initPgVector();
