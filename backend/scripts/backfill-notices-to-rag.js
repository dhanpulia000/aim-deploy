/**
 * 기존 CustomerFeedbackNotice(공지사항)를 RAG 데이터(WorkGuide + guide_embeddings)에 백필
 *
 * 사용법:
 *   cd backend && node scripts/backfill-notices-to-rag.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { query } = require('../libs/db');
const logger = require('../utils/logger');
const {
  getNoticeGuideSyncService
} = require('../services/noticeGuideSync.service');

const noticeGuideSyncService = getNoticeGuideSyncService();

async function main() {
  console.log('\n=== 공지사항 → RAG 백필 시작 ===\n');

  const notices = query(
    'SELECT * FROM CustomerFeedbackNotice WHERE 1=1 ORDER BY noticeDate DESC'
  );

  if (!notices || notices.length === 0) {
    console.log('공지사항이 없습니다. 종료합니다.\n');
    return;
  }

  console.log(`총 공지사항: ${notices.length}개\n`);

  let synced = 0;
  let failed = 0;

  for (const notice of notices) {
    try {
      await noticeGuideSyncService.syncFromNotice(notice);
      console.log(
        `✅ [${notice.id}] ${String(notice.category || '').slice(0, 20)} - ${String(
          notice.noticeDate || ''
        ).slice(0, 10)}`
      );
      synced++;
    } catch (error) {
      console.error(
        `❌ [${notice.id}] 동기화 실패: ${error.message}`
      );
      logger.warn('[BackfillNoticesToRAG] Failed to sync notice', {
        noticeId: notice.id,
        error: error.message
      });
      failed++;
    }
  }

  console.log('\n=== 공지사항 → RAG 백필 완료 ===');
  console.log(`   동기화 성공: ${synced}개`);
  console.log(`   동기화 실패: ${failed}개\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[BackfillNoticesToRAG] Script failed', {
      error: err.message,
      stack: err.stack
    });
    console.error('\n❌ 스크립트 실행 실패:', err.message);
    process.exit(1);
  });

