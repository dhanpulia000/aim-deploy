/**
 * Issue 본문 누락 수정 스크립트
 * RawLog에는 본문이 있는데 Issue에는 본문이 비어있거나 매우 짧은 경우 수정
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function fixMissingIssueContent() {
  try {
    logger.info('[FixMissingContent] Starting missing Issue content fix');

    // RawLog에는 본문이 있는데 Issue에는 본문이 비어있거나 매우 짧은 경우 찾기
    const issuesToFix = query(`
      SELECT 
        i.id as issueId,
        i.externalPostId,
        i.summary,
        i.detail as issueDetail,
        length(i.detail) as issueDetailLen,
        r.id as rawLogId,
        r.content as rawLogContent,
        length(r.content) as rawLogContentLen
      FROM ReportItemIssue i
      INNER JOIN RawLog r ON r.source = 'naver' 
        AND json_extract(r.metadata, '$.externalPostId') = i.externalPostId
      WHERE i.source LIKE 'NAVER%'
        AND r.content IS NOT NULL
        AND length(r.content) > 50
        AND (i.detail IS NULL OR i.detail = '' OR length(i.detail) < 20 OR i.detail = i.summary)
        AND length(r.content) > length(COALESCE(i.detail, ''))
      ORDER BY i.createdAt DESC
      LIMIT 100
    `);

    logger.info('[FixMissingContent] Found issues with missing content', {
      count: issuesToFix.length
    });

    let fixedCount = 0;

    for (const item of issuesToFix) {
      const rawLogContent = (item.rawLogContent || '').trim();
      const issueDetail = (item.issueDetail || '').trim();
      
      // RawLog 본문이 Issue 본문보다 훨씬 길면 업데이트
      if (rawLogContent.length > issueDetail.length && rawLogContent.length >= 20) {
        execute(
          'UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?',
          [rawLogContent, new Date().toISOString(), item.issueId]
        );
        
        fixedCount++;
        logger.info('[FixMissingContent] Fixed missing Issue content', {
          issueId: item.issueId,
          externalPostId: item.externalPostId,
          oldDetailLength: issueDetail.length,
          newDetailLength: rawLogContent.length,
          summary: item.summary?.substring(0, 50)
        });
      }
    }

    logger.info('[FixMissingContent] Fix completed', {
      totalFixed: fixedCount
    });

    console.log('\n✅ Issue 본문 누락 수정 완료');
    console.log(`  수정된 Issue: ${fixedCount}개`);

  } catch (error) {
    logger.error('[FixMissingContent] Fix failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  fixMissingIssueContent()
    .then(() => {
      logger.info('[FixMissingContent] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[FixMissingContent] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { fixMissingIssueContent };





