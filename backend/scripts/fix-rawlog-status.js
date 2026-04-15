/**
 * RawLog 상태 불일치 수정 스크립트
 * - isProcessed와 processingStatus 불일치 수정
 * - NEW 상태인 RawLog들을 처리 가능한 상태로 변경
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function fixRawLogStatus() {
  try {
    logger.info('[FixRawLogStatus] Starting RawLog status fix');

    // 1. isProcessed=1이지만 processingStatus='NEW'인 경우 → DONE으로 변경
    const fixed1 = execute(
      `UPDATE RawLog 
       SET processingStatus = 'DONE'
       WHERE isProcessed = 1 AND processingStatus = 'NEW'`
    );
    logger.info('[FixRawLogStatus] Fixed isProcessed=1 but status=NEW', {
      count: fixed1.changes
    });

    // 2. isProcessed=0이지만 processingStatus='DONE'인 경우 → NEW로 변경
    const fixed2 = execute(
      `UPDATE RawLog 
       SET processingStatus = 'NEW'
       WHERE isProcessed = 0 AND processingStatus = 'DONE'`
    );
    logger.info('[FixRawLogStatus] Fixed isProcessed=0 but status=DONE', {
      count: fixed2.changes
    });

    // 3. processingStatus가 NULL인 경우 → isProcessed에 따라 설정
    const fixed3 = execute(
      `UPDATE RawLog 
       SET processingStatus = CASE 
         WHEN isProcessed = 0 THEN 'NEW'
         WHEN isProcessed = 1 THEN 'DONE'
         ELSE 'NEW'
       END
       WHERE processingStatus IS NULL`
    );
    logger.info('[FixRawLogStatus] Fixed NULL processingStatus', {
      count: fixed3.changes
    });

    // 4. PROCESSING 상태이지만 락이 만료된 경우 → NEW로 변경 (재처리 가능하게)
    const fixed4 = execute(
      `UPDATE RawLog 
       SET processingStatus = 'NEW',
           lockedAt = NULL
       WHERE processingStatus = 'PROCESSING' 
         AND (lockedAt IS NULL OR lockedAt <= datetime('now', '-' || 10 || ' minutes'))
         AND isProcessed = 0`
    );
    logger.info('[FixRawLogStatus] Fixed expired PROCESSING locks', {
      count: fixed4.changes
    });

    // 최종 통계
    const stats = queryOne(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN isProcessed=0 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN processingStatus='NEW' THEN 1 ELSE 0 END) as new_status,
        SUM(CASE WHEN processingStatus='PROCESSING' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN processingStatus='ERROR' THEN 1 ELSE 0 END) as error,
        SUM(CASE WHEN processingStatus='DONE' THEN 1 ELSE 0 END) as done
       FROM RawLog`
    );

    logger.info('[FixRawLogStatus] Final statistics', stats);
    console.log('\n✅ RawLog 상태 수정 완료');
    console.log('최종 통계:');
    console.log(`  전체: ${stats.total}`);
    console.log(`  대기중 (isProcessed=0): ${stats.pending}`);
    console.log(`  NEW: ${stats.new_status}`);
    console.log(`  PROCESSING: ${stats.processing}`);
    console.log(`  ERROR: ${stats.error}`);
    console.log(`  DONE: ${stats.done}`);

  } catch (error) {
    logger.error('[FixRawLogStatus] Failed to fix RawLog status', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  fixRawLogStatus()
    .then(() => {
      logger.info('[FixRawLogStatus] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[FixRawLogStatus] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { fixRawLogStatus };





