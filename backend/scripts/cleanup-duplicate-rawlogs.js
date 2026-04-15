/**
 * 중복 RawLog 정리 스크립트
 * 같은 externalPostId를 가진 RawLog 중 가장 최신 것만 남기고 나머지 삭제
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function cleanupDuplicateRawLogs() {
  try {
    logger.info('[CleanupDuplicateRawLogs] Starting duplicate RawLog cleanup');

    // 1. 같은 externalPostId를 가진 RawLog 그룹 찾기
    const duplicates = query(`
      SELECT 
        json_extract(metadata, '$.externalPostId') as postId,
        COUNT(*) as cnt,
        GROUP_CONCAT(id) as ids
      FROM RawLog
      WHERE source = 'naver'
        AND metadata IS NOT NULL
        AND json_extract(metadata, '$.externalPostId') IS NOT NULL
      GROUP BY postId
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
    `);

    logger.info('[CleanupDuplicateRawLogs] Found duplicate groups', {
      count: duplicates.length
    });

    let totalDeleted = 0;
    let totalKept = 0;

    for (const dup of duplicates) {
      const postId = dup.postId;
      const ids = dup.ids.split(',');
      
      // 각 그룹에서 가장 최신 RawLog 찾기 (createdAt 기준)
      const logs = query(
        `SELECT id, createdAt, isProcessed, processingStatus, content, metadata
         FROM RawLog
         WHERE id IN (${ids.map(() => '?').join(',')})
         ORDER BY createdAt DESC`,
        ids
      );

      if (logs.length === 0) continue;

      // 가장 최신 RawLog를 기준으로 선택
      // 우선순위: 1) isProcessed=0 (미처리), 2) content가 긴 것, 3) 가장 최신
      const keepLog = logs.reduce((best, current) => {
        if (!best) return current;
        
        // 미처리 우선
        if (current.isProcessed === 0 && best.isProcessed === 1) return current;
        if (current.isProcessed === 1 && best.isProcessed === 0) return best;
        
        // content 길이 우선
        const currentLen = (current.content || '').length;
        const bestLen = (best.content || '').length;
        if (currentLen > bestLen) return current;
        if (currentLen < bestLen) return best;
        
        // 최신 우선
        return new Date(current.createdAt) > new Date(best.createdAt) ? current : best;
      });

      // 나머지 삭제
      const toDelete = logs.filter(log => log.id !== keepLog.id);
      
      for (const log of toDelete) {
        execute('DELETE FROM RawLog WHERE id = ?', [log.id]);
        totalDeleted++;
      }
      
      totalKept++;
      
      logger.info('[CleanupDuplicateRawLogs] Cleaned up duplicate group', {
        postId,
        totalInGroup: logs.length,
        keptId: keepLog.id,
        deletedCount: toDelete.length,
        keptIsProcessed: keepLog.isProcessed,
        keptContentLength: (keepLog.content || '').length
      });
    }

    logger.info('[CleanupDuplicateRawLogs] Cleanup completed', {
      duplicateGroups: duplicates.length,
      totalDeleted,
      totalKept
    });

    console.log('\n✅ 중복 RawLog 정리 완료');
    console.log(`  중복 그룹: ${duplicates.length}개`);
    console.log(`  삭제된 RawLog: ${totalDeleted}개`);
    console.log(`  유지된 RawLog: ${totalKept}개`);

  } catch (error) {
    logger.error('[CleanupDuplicateRawLogs] Cleanup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  cleanupDuplicateRawLogs()
    .then(() => {
      logger.info('[CleanupDuplicateRawLogs] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[CleanupDuplicateRawLogs] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { cleanupDuplicateRawLogs };





