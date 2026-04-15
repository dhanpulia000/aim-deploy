/**
 * 마이그레이션 003 실행 스크립트
 * RawLog 테이블에 처리 상태 관리 컬럼 추가
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { execute, query } = require('../libs/db');
const logger = require('../utils/logger');

async function runMigration() {
  try {
    logger.info('[Migration 003] Starting migration: Add RawLog processing status columns');
    
    // 1. processingStatus 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN processingStatus TEXT NOT NULL DEFAULT \'NEW\';');
      logger.info('[Migration 003] Added processingStatus column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration 003] processingStatus column already exists');
      } else {
        throw error;
      }
    }
    
    // 2. attempts 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;');
      logger.info('[Migration 003] Added attempts column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration 003] attempts column already exists');
      } else {
        throw error;
      }
    }
    
    // 3. lastError 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN lastError TEXT NULL;');
      logger.info('[Migration 003] Added lastError column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration 003] lastError column already exists');
      } else {
        throw error;
      }
    }
    
    // 4. lockedAt 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN lockedAt TEXT NULL;');
      logger.info('[Migration 003] Added lockedAt column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration 003] lockedAt column already exists');
      } else {
        throw error;
      }
    }
    
    // 5. nextRetryAt 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN nextRetryAt TEXT NULL;');
      logger.info('[Migration 003] Added nextRetryAt column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration 003] nextRetryAt column already exists');
      } else {
        throw error;
      }
    }
    
    // 6. 기존 데이터 초기화
    try {
      execute(`
        UPDATE RawLog 
        SET processingStatus = CASE 
          WHEN isProcessed = 0 THEN 'NEW'
          WHEN isProcessed = 1 THEN 'DONE'
          ELSE 'NEW'
        END
        WHERE processingStatus = 'NEW' OR processingStatus IS NULL;
      `);
      logger.info('[Migration 003] Initialized existing data');
    } catch (error) {
      logger.warn('[Migration 003] Failed to initialize existing data', { error: error.message });
    }
    
    // 7. 인덱스 생성
    try {
      execute('CREATE INDEX IF NOT EXISTS idx_rawlog_status_retry ON RawLog(processingStatus, nextRetryAt);');
      logger.info('[Migration 003] Created index idx_rawlog_status_retry');
    } catch (error) {
      logger.warn('[Migration 003] Failed to create index idx_rawlog_status_retry', { error: error.message });
    }
    
    try {
      execute('CREATE INDEX IF NOT EXISTS idx_rawlog_status_locked ON RawLog(processingStatus, lockedAt);');
      logger.info('[Migration 003] Created index idx_rawlog_status_locked');
    } catch (error) {
      logger.warn('[Migration 003] Failed to create index idx_rawlog_status_locked', { error: error.message });
    }
    
    try {
      execute('CREATE INDEX IF NOT EXISTS idx_rawlog_status_processed ON RawLog(processingStatus, isProcessed);');
      logger.info('[Migration 003] Created index idx_rawlog_status_processed');
    } catch (error) {
      logger.warn('[Migration 003] Failed to create index idx_rawlog_status_processed', { error: error.message });
    }
    
    logger.info('[Migration 003] Migration completed successfully');
    
    // 마이그레이션 결과 확인
    const columns = query('PRAGMA table_info(RawLog)');
    const newColumns = columns.filter(c => 
      ['processingStatus', 'attempts', 'lastError', 'lockedAt', 'nextRetryAt'].includes(c.name)
    );
    
    logger.info('[Migration 003] Migration verification', {
      addedColumns: newColumns.map(c => c.name),
      totalColumns: newColumns.length
    });
    
    if (newColumns.length !== 5) {
      logger.warn('[Migration 003] Some columns may not have been added', {
        expected: 5,
        actual: newColumns.length
      });
    }
    
  } catch (error) {
    logger.error('[Migration 003] Migration failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  runMigration()
    .then(() => {
      logger.info('[Migration 003] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[Migration 003] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { runMigration };

