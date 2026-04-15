/**
 * 이슈 승격 시 본문 등록 확인 스크립트
 * 최근 승격된 이슈들의 제목/본문 상태 확인
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../libs/db');
const logger = require('../utils/logger');

async function checkIssuePromotion() {
  try {
    logger.info('[CheckIssuePromotion] Checking recent issues');

    // 최근 생성된 Issue 중 제목과 본문이 같은 항목 찾기
    const sameIssues = query(`
      SELECT 
        id,
        summary,
        detail,
        sourceUrl,
        externalPostId,
        createdAt,
        length(summary) as summaryLen,
        length(detail) as detailLen
      FROM ReportItemIssue
      WHERE source LIKE 'NAVER%'
        AND summary IS NOT NULL
        AND detail IS NOT NULL
        AND summary != ''
        AND detail != ''
        AND summary = detail
      ORDER BY createdAt DESC
      LIMIT 20
    `);

    logger.info('[CheckIssuePromotion] Found issues with same title and detail', {
      count: sameIssues.length
    });

    console.log('\n=== 제목과 본문이 동일한 Issue ===\n');

    for (const issue of sameIssues) {
      console.log(`[Issue ID: ${issue.id}]`);
      console.log(`제목/본문: "${issue.summary}"`);
      console.log(`길이: ${issue.summaryLen}자`);
      console.log(`생성일: ${issue.createdAt}`);
      console.log(`URL: ${issue.sourceUrl?.substring(0, 100) || 'N/A'}`);
      
      // RawLog 확인
      if (issue.externalPostId) {
        const rawLogs = query(`
          SELECT 
            id,
            content,
            length(content) as contentLen,
            metadata,
            createdAt
          FROM RawLog
          WHERE source = 'naver'
            AND json_extract(metadata, '$.externalPostId') = ?
          ORDER BY createdAt DESC
          LIMIT 1
        `, [issue.externalPostId]);
        
        if (rawLogs.length > 0) {
          const rawLog = rawLogs[0];
          let metadata = {};
          try {
            metadata = JSON.parse(rawLog.metadata || '{}');
          } catch (e) {}
          
          console.log(`  RawLog:`);
          console.log(`    content 길이: ${rawLog.contentLen || 0}자`);
          console.log(`    content: "${rawLog.content?.substring(0, 100) || '(없음)'}"`);
          console.log(`    metadata.title: "${metadata.title || '(없음)'}"`);
          console.log(`    metadata.requiresLogin: ${metadata.requiresLogin}`);
        }
      }
      
      console.log('');
    }

    // 최근 생성된 Issue 중 본문이 비어있는 항목
    const emptyDetailIssues = query(`
      SELECT 
        id,
        summary,
        detail,
        sourceUrl,
        externalPostId,
        createdAt,
        length(summary) as summaryLen
      FROM ReportItemIssue
      WHERE source LIKE 'NAVER%'
        AND summary IS NOT NULL
        AND summary != ''
        AND (detail IS NULL OR detail = '')
      ORDER BY createdAt DESC
      LIMIT 20
    `);

    logger.info('[CheckIssuePromotion] Found issues with empty detail', {
      count: emptyDetailIssues.length
    });

    console.log('\n=== 본문이 비어있는 Issue (최근 10개) ===\n');

    for (const issue of emptyDetailIssues.slice(0, 10)) {
      console.log(`[Issue ID: ${issue.id}]`);
      console.log(`제목: "${issue.summary}"`);
      console.log(`생성일: ${issue.createdAt}`);
      console.log('');
    }

    console.log('\n=== 통계 ===');
    console.log(`제목=본문: ${sameIssues.length}개`);
    console.log(`본문 비어있음: ${emptyDetailIssues.length}개`);

  } catch (error) {
    logger.error('[CheckIssuePromotion] Check failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  checkIssuePromotion()
    .then(() => {
      logger.info('[CheckIssuePromotion] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[CheckIssuePromotion] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { checkIssuePromotion };




