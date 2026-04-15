/**
 * 제목과 본문이 동일한 Issue 수정 스크립트
 * detail이 summary와 동일하면 detail을 비움
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function fixDuplicateTitleDetail() {
  try {
    logger.info('[FixDuplicateTitleDetail] Starting fix');

    // 제목과 본문이 동일한 Issue 찾기
    const issues = query(`
      SELECT 
        id, 
        summary, 
        detail,
        externalPostId,
        sourceUrl,
        createdAt
      FROM ReportItemIssue 
      WHERE source LIKE 'NAVER%' 
        AND summary IS NOT NULL
        AND detail IS NOT NULL
        AND summary != ''
        AND detail != ''
        AND summary = detail
      ORDER BY createdAt DESC
    `);

    logger.info('[FixDuplicateTitleDetail] Found issues with duplicate title and detail', {
      count: issues.length
    });

    let fixedCount = 0;

    for (const issue of issues) {
      // detail을 비움
      execute(
        'UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?',
        ['', new Date().toISOString(), issue.id]
      );
      fixedCount++;
      
      logger.info('[FixDuplicateTitleDetail] Fixed issue', {
        issueId: issue.id,
        externalPostId: issue.externalPostId,
        summary: issue.summary.substring(0, 50),
        createdAt: issue.createdAt
      });
    }

    logger.info('[FixDuplicateTitleDetail] Fix completed', {
      totalFixed: fixedCount
    });

    console.log('\n✅ 제목과 본문이 동일한 Issue 수정 완료');
    console.log(`  수정된 항목: ${fixedCount}개`);

  } catch (error) {
    logger.error('[FixDuplicateTitleDetail] Fix failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  fixDuplicateTitleDetail()
    .then(() => {
      logger.info('[FixDuplicateTitleDetail] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[FixDuplicateTitleDetail] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { fixDuplicateTitleDetail };





