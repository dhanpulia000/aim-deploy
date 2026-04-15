/**
 * 업무 가이드 데이터베이스 스키마 초기화 스크립트
 */

// 환경 변수 로드
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { query, execute } = require('../libs/db');
const { query: pgQuery, execute: pgExecute } = require('../libs/db-postgres');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

async function initSQLiteSchema() {
  logger.info('[InitGuideSchema] Initializing SQLite schema...');

  // WorkGuide 테이블 생성
  execute(`
    CREATE TABLE IF NOT EXISTS WorkGuide (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      categoryGroupId INTEGER,
      categoryId INTEGER,
      guideType TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      tags TEXT,
      metadata TEXT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (categoryGroupId) REFERENCES CategoryGroup(id),
      FOREIGN KEY (categoryId) REFERENCES Category(id)
    )
  `);

  // 인덱스 생성
  execute(`
    CREATE INDEX IF NOT EXISTS idx_workguide_category 
    ON WorkGuide(categoryGroupId, categoryId)
  `);

  execute(`
    CREATE INDEX IF NOT EXISTS idx_workguide_type 
    ON WorkGuide(guideType)
  `);

  execute(`
    CREATE INDEX IF NOT EXISTS idx_workguide_priority 
    ON WorkGuide(priority DESC)
  `);

  logger.info('[InitGuideSchema] SQLite schema initialized');
}

async function initPostgreSQLSchema() {
  logger.info('[InitGuideSchema] Initializing PostgreSQL schema...');

  // IMPORTANT:
  // - WorkGuide 메타데이터는 Postgres를 쓰는 환경이 존재한다.
  // - pgvector(vector 타입)가 없더라도 WorkGuide 스키마/컬럼 보완은 반드시 성공해야 한다.
  try {
    // WorkGuide 테이블 생성/마이그레이션 (PostgreSQL)
    // NOTE:
    // - 일부 환경에서는 WorkGuide 메타데이터도 Postgres를 사용합니다(db-pg-facade 경유).
    // - 기존에 WorkGuide가 "부분 컬럼"으로 이미 존재하는 경우가 있어, CREATE TABLE만으로는 부족합니다.
    await pgExecute(`
      CREATE TABLE IF NOT EXISTS WorkGuide (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        guideType TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        tags TEXT,
        metadata TEXT,
        createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // legacy schema -> add missing columns safely
    await pgExecute(`ALTER TABLE WorkGuide ADD COLUMN IF NOT EXISTS categoryGroupId BIGINT`);
    await pgExecute(`ALTER TABLE WorkGuide ADD COLUMN IF NOT EXISTS categoryId BIGINT`);

    await pgExecute(`
      CREATE INDEX IF NOT EXISTS idx_workguide_category
      ON WorkGuide(categoryGroupId, categoryId)
    `);

    await pgExecute(`
      CREATE INDEX IF NOT EXISTS idx_workguide_type
      ON WorkGuide(guideType)
    `);

    await pgExecute(`
      CREATE INDEX IF NOT EXISTS idx_workguide_priority
      ON WorkGuide(priority DESC)
    `);

    // pgvector / guide_embeddings: 있으면 만들고, 없으면 경고 후 스킵 (WorkGuide는 계속 사용 가능해야 함)
    try {
      // Try to enable pgvector if available (permission may be required)
      await pgExecute(`CREATE EXTENSION IF NOT EXISTS vector`);
    } catch (e) {
      logger.warn('[InitGuideSchema] Could not create pgvector extension (will continue without embeddings)', {
        error: e?.message || String(e),
      });
    }

    try {
      // guide_embeddings 테이블 생성
      await pgExecute(`
        CREATE TABLE IF NOT EXISTS guide_embeddings (
          id TEXT PRIMARY KEY,
          guide_id TEXT NOT NULL,
          embedding vector(1536),
          chunk_index INTEGER DEFAULT 0,
          chunk_text TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(guide_id, chunk_index)
        )
      `);

      // 인덱스 생성
      await pgExecute(`
        CREATE INDEX IF NOT EXISTS guide_embeddings_vector_idx 
        ON guide_embeddings 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      await pgExecute(`
        CREATE INDEX IF NOT EXISTS guide_embeddings_guide_id_idx 
        ON guide_embeddings(guide_id)
      `);

      await pgExecute(`
        CREATE INDEX IF NOT EXISTS guide_embeddings_chunk_idx 
        ON guide_embeddings(guide_id, chunk_index)
      `);
    } catch (e) {
      logger.warn('[InitGuideSchema] guide_embeddings not initialized (pgvector missing). You can still use WorkGuide CRUD without embeddings.', {
        error: e?.message || String(e),
      });
    }

    logger.info('[InitGuideSchema] PostgreSQL schema initialized');
  } catch (error) {
    logger.error('[InitGuideSchema] PostgreSQL schema initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function main() {
  try {
    const isPostgres = /^postgres/i.test(process.env.DATABASE_URL || "");
    if (!isPostgres) {
      // SQLite 환경일 때만 SQLite WorkGuide 스키마를 만든다.
      // (Postgres 환경에서는 ./libs/db 가 Postgres 파사드를 사용하므로 SQLite DDL을 실행하면 실패할 수 있음)
      await initSQLiteSchema();
    }
    await initPostgreSQLSchema();
    logger.info('[InitGuideSchema] Schema initialization completed');
    process.exit(0);
  } catch (error) {
    logger.error('[InitGuideSchema] Initialization failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  initSQLiteSchema,
  initPostgreSQLSchema
};
