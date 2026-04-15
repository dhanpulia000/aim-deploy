/**
 * RawLog 테이블 마이그레이션 실행 스크립트
 * backend/migrations/002_add_rawlog_board_article_columns.sql 실행
 */

require('dotenv').config();
const { execute, query } = require('../libs/db');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

async function runMigration() {
  try {
    logger.info('[Migration] Starting migration 002: Add RawLog boardId/articleId columns');
    
    // 1. boardId 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN boardId INTEGER;');
      logger.info('[Migration] Added boardId column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration] boardId column already exists');
      } else {
        throw error;
      }
    }
    
    // 2. articleId 컬럼 추가
    try {
      execute('ALTER TABLE RawLog ADD COLUMN articleId TEXT;');
      logger.info('[Migration] Added articleId column');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column name')) {
        logger.warn('[Migration] articleId column already exists');
      } else {
        throw error;
      }
    }
    
    // 3. 기존 데이터의 metadata에서 boardId, articleId 추출하여 업데이트
    try {
      execute(`
        UPDATE RawLog 
        SET 
          boardId = CAST(
            json_extract(metadata, '$.monitoredBoardId') AS INTEGER
          ),
          articleId = json_extract(metadata, '$.externalPostId')
        WHERE 
          source = 'naver' 
          AND metadata IS NOT NULL
          AND metadata != '{}'
          AND (
            json_extract(metadata, '$.monitoredBoardId') IS NOT NULL
            OR json_extract(metadata, '$.externalPostId') IS NOT NULL
          );
      `);
      logger.info('[Migration] Updated existing data from metadata');
    } catch (error) {
      logger.warn('[Migration] Failed to update existing data', { error: error.message });
      // 업데이트 실패해도 계속 진행
    }
    
    // 3-1. 중복 데이터 정리 (같은 boardId, articleId 조합 중 가장 오래된 것만 남기고 나머지 삭제)
    try {
      const duplicates = query(`
        SELECT boardId, articleId, COUNT(*) as count
        FROM RawLog
        WHERE boardId IS NOT NULL AND articleId IS NOT NULL
        GROUP BY boardId, articleId
        HAVING COUNT(*) > 1
      `);
      
      if (duplicates.length > 0) {
        logger.warn('[Migration] Found duplicate (boardId, articleId) combinations', { count: duplicates.length });
        
        for (const dup of duplicates) {
          // 각 중복 그룹에서 가장 오래된 것(id가 가장 작은 것)만 남기고 나머지 삭제
          execute(`
            DELETE FROM RawLog
            WHERE boardId = ? AND articleId = ?
            AND id NOT IN (
              SELECT id FROM RawLog
              WHERE boardId = ? AND articleId = ?
              ORDER BY createdAt ASC
              LIMIT 1
            )
          `, [dup.boardId, dup.articleId, dup.boardId, dup.articleId]);
        }
        
        logger.info('[Migration] Cleaned up duplicate records', { duplicatesCount: duplicates.length });
      }
    } catch (error) {
      logger.warn('[Migration] Failed to clean up duplicates', { error: error.message });
      // 중복 정리 실패해도 계속 진행
    }
    
    // 4. 유니크 인덱스 생성
    try {
      execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_rawlog_board_article ON RawLog(boardId, articleId);');
      logger.info('[Migration] Created unique index idx_rawlog_board_article');
    } catch (error) {
      if (error.message && error.message.includes('already exists')) {
        logger.warn('[Migration] Unique index already exists');
      } else if (error.message && error.message.includes('UNIQUE constraint failed')) {
        logger.error('[Migration] Cannot create unique index due to duplicate data', { error: error.message });
        logger.warn('[Migration] Please clean up duplicate data manually and retry');
        throw new Error('Duplicate data exists. Please clean up duplicates and retry.');
      } else {
        throw error;
      }
    }
    
    // 5. 인덱스 추가
    try {
      execute('CREATE INDEX IF NOT EXISTS idx_rawlog_boardId ON RawLog(boardId);');
      logger.info('[Migration] Created index idx_rawlog_boardId');
    } catch (error) {
      logger.warn('[Migration] Failed to create boardId index', { error: error.message });
    }
    
    try {
      execute('CREATE INDEX IF NOT EXISTS idx_rawlog_articleId ON RawLog(articleId);');
      logger.info('[Migration] Created index idx_rawlog_articleId');
    } catch (error) {
      logger.warn('[Migration] Failed to create articleId index', { error: error.message });
    }
    
    // 마이그레이션 결과 확인
    const columns = query('PRAGMA table_info(RawLog)');
    const hasBoardId = columns.some(c => c.name === 'boardId');
    const hasArticleId = columns.some(c => c.name === 'articleId');
    
    const indexes = query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='RawLog'");
    const hasUniqueIndex = indexes.some(i => i.name === 'idx_rawlog_board_article');
    
    logger.info('[Migration] Migration 002 completed', {
      boardIdColumn: hasBoardId,
      articleIdColumn: hasArticleId,
      uniqueIndex: hasUniqueIndex
    });
    
    if (!hasBoardId || !hasArticleId || !hasUniqueIndex) {
      logger.warn('[Migration] Some migration steps may have failed', {
        hasBoardId,
        hasArticleId,
        hasUniqueIndex
      });
    }
    
    console.log('✅ Migration 002 completed successfully');
  } catch (error) {
    logger.error('[Migration] Migration 002 failed', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();

