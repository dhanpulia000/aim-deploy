/**
 * 잘못된 로그인 필요 표시 수정 스크립트
 * 1. 본문이 충분히 긴 Issue는 requiresLogin=false로 수정
 * 2. 중복 수집으로 인한 잘못된 requiresLogin 수정
 * 3. 최근 항목 중 본문이 있지만 잘못 분류된 항목 수정
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function fixIncorrectRequiresLogin(options = {}) {
  try {
    const { recentOnly = false, hours = 24 } = options;
    logger.info('[FixRequiresLogin] Starting incorrect requiresLogin fix', { recentOnly, hours });

    let fixedCount = 0;

    // 0. 최근 항목 중 본문이 있지만 잘못 분류된 항목 수정 (최근 24시간 또는 최근 100개)
    // 최근 항목은 항상 확인하여 빠르게 수정
    const recentCutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const recentIssues = query(`
      SELECT id, externalPostId, summary, detail, requiresLogin, length(detail) as detailLen, createdAt
      FROM ReportItemIssue
      WHERE source LIKE 'NAVER%'
        AND requiresLogin = 1
        AND detail IS NOT NULL
        AND detail != ''
        AND length(detail) > 0
        AND createdAt >= ?
      ORDER BY createdAt DESC
      LIMIT 100
    `, [recentCutoff]);

    logger.info('[FixRequiresLogin] Found recent issues with content but requiresLogin=true', {
      count: recentIssues.length
    });

    for (const issue of recentIssues) {
      // 제목이 일반적인 제목인지 확인
      const genericTitlePatterns = [
        /^네이버\s*카페$/i,
        /^배틀그라운드\s*공식카페\s*-\s*PUBG:? ?BATTLEGROUNDS/i
      ];
      const isGenericTitle = genericTitlePatterns.some(pattern => pattern.test(issue.summary || ''));

      // 일반적인 제목이 아니고 본문이 있으면 로그인 필요 없음
      // (본문이 3자 이상이면 실제 내용이 있다고 간주)
      if (!isGenericTitle && issue.detailLen >= 3) {
        execute(
          'UPDATE ReportItemIssue SET requiresLogin = 0, updatedAt = ? WHERE id = ?',
          [new Date().toISOString(), issue.id]
        );
        fixedCount++;
        logger.info('[FixRequiresLogin] Fixed recent issue with content', {
          issueId: issue.id,
          externalPostId: issue.externalPostId,
          detailLength: issue.detailLen,
          summary: issue.summary?.substring(0, 50),
          createdAt: issue.createdAt
        });
      }
    }

    // 1. 본문이 충분히 긴 Issue는 requiresLogin=false로 수정
    // (본문이 50자 이상이면 로그인 필요 없이도 볼 수 있는 게시글)
    const longContentIssues = query(`
      SELECT id, externalPostId, summary, detail, requiresLogin, length(detail) as detailLen
      FROM ReportItemIssue
      WHERE source LIKE 'NAVER%'
        AND requiresLogin = 1
        AND detail IS NOT NULL
        AND length(detail) >= 50
    `);

    logger.info('[FixRequiresLogin] Found issues with long content but requiresLogin=true', {
      count: longContentIssues.length
    });

    for (const issue of longContentIssues) {
      // 제목이 일반적인 제목인지 확인
      const genericTitlePatterns = [
        /^네이버\s*카페$/i,
        /^배틀그라운드\s*공식카페\s*-\s*PUBG:? ?BATTLEGROUNDS/i
      ];
      const isGenericTitle = genericTitlePatterns.some(pattern => pattern.test(issue.summary || ''));

      // 일반적인 제목이 아니고 본문이 충분히 길면 로그인 필요 없음
      if (!isGenericTitle && issue.detailLen >= 50) {
        execute(
          'UPDATE ReportItemIssue SET requiresLogin = 0, updatedAt = ? WHERE id = ?',
          [new Date().toISOString(), issue.id]
        );
        fixedCount++;
        logger.info('[FixRequiresLogin] Fixed issue with long content', {
          issueId: issue.id,
          externalPostId: issue.externalPostId,
          detailLength: issue.detailLen,
          summary: issue.summary?.substring(0, 50)
        });
      }
    }

    // 2. 같은 externalPostId를 가진 Issue 중 requiresLogin이 다른 경우 확인
    // (중복 수집으로 인한 문제)
    const duplicateIssues = query(`
      SELECT externalPostId, 
             COUNT(*) as cnt,
             SUM(CASE WHEN requiresLogin = 1 THEN 1 ELSE 0 END) as loginCount,
             SUM(CASE WHEN requiresLogin = 0 THEN 1 ELSE 0 END) as normalCount
      FROM ReportItemIssue
      WHERE source LIKE 'NAVER%'
        AND externalPostId IS NOT NULL
      GROUP BY externalPostId
      HAVING cnt > 1 AND loginCount > 0 AND normalCount > 0
    `);

    logger.info('[FixRequiresLogin] Found duplicate issues with mixed requiresLogin', {
      count: duplicateIssues.length
    });

    for (const dup of duplicateIssues) {
      // 같은 externalPostId를 가진 모든 Issue 조회
      const issues = query(
        'SELECT id, requiresLogin, detail, length(detail) as detailLen FROM ReportItemIssue WHERE externalPostId = ? ORDER BY createdAt DESC',
        [dup.externalPostId]
      );

      // 본문이 가장 긴 Issue를 기준으로 결정
      const bestIssue = issues.reduce((best, current) => {
        if (!best) return current;
        return current.detailLen > best.detailLen ? current : best;
      });

      // 본문이 긴 Issue의 requiresLogin을 기준으로 다른 Issue들도 수정
      const targetRequiresLogin = bestIssue.detailLen >= 50 ? 0 : bestIssue.requiresLogin;

      for (const issue of issues) {
        if (issue.requiresLogin !== targetRequiresLogin) {
          execute(
            'UPDATE ReportItemIssue SET requiresLogin = ?, updatedAt = ? WHERE id = ?',
            [targetRequiresLogin, new Date().toISOString(), issue.id]
          );
          fixedCount++;
          logger.info('[FixRequiresLogin] Fixed duplicate issue requiresLogin', {
            issueId: issue.id,
            externalPostId: dup.externalPostId,
            oldRequiresLogin: issue.requiresLogin,
            newRequiresLogin: targetRequiresLogin,
            detailLength: issue.detailLen
          });
        }
      }
    }

    // 3. Issue와 매칭되는 RawLog에서 requiresLogin 수정
    // Issue에 detail이 있으면 해당 RawLog의 requiresLogin을 false로 수정
    const issuesWithDetail = query(`
      SELECT id, externalPostId, detail, length(detail) as detailLen, requiresLogin
      FROM ReportItemIssue
      WHERE source LIKE 'NAVER%'
        AND externalPostId IS NOT NULL
        AND detail IS NOT NULL
        AND detail != ''
        AND length(detail) >= 3
        AND createdAt >= ?
    `, [recentCutoff]);

    logger.info('[FixRequiresLogin] Found issues with detail to match with RawLogs', {
      count: issuesWithDetail.length
    });

    for (const issue of issuesWithDetail) {
      // 같은 externalPostId를 가진 RawLog 찾기
      const rawLogs = query(
        `SELECT id, metadata, content, length(content) as contentLen 
         FROM RawLog 
         WHERE source = 'naver'
           AND json_extract(metadata, '$.externalPostId') = ? 
         ORDER BY createdAt DESC
         LIMIT 10`,
        [issue.externalPostId]
      );

      for (const rawLog of rawLogs) {
        const meta = JSON.parse(rawLog.metadata || '{}');
        // Issue에 본문이 있고 requiresLogin이 false면, RawLog도 false로 수정
        // (RawLog의 content가 0자여도 Issue에 detail이 있으면 수정)
        if (issue.detailLen >= 3 && !issue.requiresLogin && meta.requiresLogin === true) {
          meta.requiresLogin = false;
          execute(
            'UPDATE RawLog SET metadata = ?, updatedAt = ? WHERE id = ?',
            [JSON.stringify(meta), new Date().toISOString(), rawLog.id]
          );
          fixedCount++;
          logger.info('[FixRequiresLogin] Fixed RawLog requiresLogin based on Issue', {
            rawLogId: rawLog.id,
            issueId: issue.id,
            externalPostId: issue.externalPostId,
            issueDetailLength: issue.detailLen,
            rawLogContentLength: rawLog.contentLen,
            oldRequiresLogin: true,
            newRequiresLogin: false
          });
        }
      }
    }

    // 3-2. 최근 RawLog 중 requiresLogin=true인 항목들을 Issue와 매칭하여 수정
    // (Issue에 detail이 있으면 RawLog의 requiresLogin을 false로 수정)
    const recentRawLogsWithLogin = query(`
      SELECT id, metadata, json_extract(metadata, '$.externalPostId') as externalPostId, createdAt
      FROM RawLog
      WHERE source = 'naver'
        AND json_extract(metadata, '$.requiresLogin') = true
        AND json_extract(metadata, '$.externalPostId') IS NOT NULL
        AND createdAt >= ?
      ORDER BY createdAt DESC
      LIMIT 500
    `, [recentCutoff]);

    logger.info('[FixRequiresLogin] Found recent RawLogs with requiresLogin=true to check against Issues', {
      count: recentRawLogsWithLogin.length
    });

    for (const rawLog of recentRawLogsWithLogin) {
      const meta = JSON.parse(rawLog.metadata || '{}');
      const externalPostId = meta.externalPostId;
      
      if (!externalPostId) continue;

      // 같은 externalPostId를 가진 Issue 찾기
      const matchingIssues = query(
        `SELECT id, detail, length(detail) as detailLen, requiresLogin
         FROM ReportItemIssue
         WHERE source LIKE 'NAVER%'
           AND externalPostId = ?
           AND detail IS NOT NULL
           AND detail != ''
           AND length(detail) >= 3
         ORDER BY createdAt DESC
         LIMIT 1`,
        [externalPostId]
      );

      if (matchingIssues.length > 0) {
        const issue = matchingIssues[0];
        // Issue에 본문이 있고 requiresLogin이 false면, RawLog도 false로 수정
        if (!issue.requiresLogin && meta.requiresLogin === true) {
          meta.requiresLogin = false;
          execute(
            'UPDATE RawLog SET metadata = ?, updatedAt = ? WHERE id = ?',
            [JSON.stringify(meta), new Date().toISOString(), rawLog.id]
          );
          fixedCount++;
          logger.info('[FixRequiresLogin] Fixed RawLog requiresLogin based on matching Issue', {
            rawLogId: rawLog.id,
            issueId: issue.id,
            externalPostId: externalPostId,
            issueDetailLength: issue.detailLen,
            oldRequiresLogin: true,
            newRequiresLogin: false
          });
        }
      }
    }

    // 4. 최근 RawLog 중 본문이 있지만 잘못 분류된 항목 수정
    const recentRawLogs = query(`
      SELECT id, metadata, content, length(content) as contentLen, createdAt
      FROM RawLog
      WHERE source = 'naver'
        AND json_extract(metadata, '$.requiresLogin') = true
        AND content IS NOT NULL
        AND content != ''
        AND length(content) >= 3
        AND createdAt >= ?
      ORDER BY createdAt DESC
      LIMIT 200
    `, [recentCutoff]);

    logger.info('[FixRequiresLogin] Found recent RawLogs with content but requiresLogin=true', {
      count: recentRawLogs.length
    });

    for (const rawLog of recentRawLogs) {
      const meta = JSON.parse(rawLog.metadata || '{}');
      const title = meta.title || '';
      
      // 제목이 일반적인 제목인지 확인
      const genericTitlePatterns = [
        /^네이버\s*카페$/i,
        /^배틀그라운드\s*공식카페\s*-\s*PUBG:? ?BATTLEGROUNDS/i
      ];
      const isGenericTitle = genericTitlePatterns.some(pattern => pattern.test(title));

      // 일반적인 제목이 아니고 본문이 있으면 로그인 필요 없음
      if (!isGenericTitle && rawLog.contentLen >= 3) {
        meta.requiresLogin = false;
        execute(
          'UPDATE RawLog SET metadata = ?, updatedAt = ? WHERE id = ?',
          [JSON.stringify(meta), new Date().toISOString(), rawLog.id]
        );
        fixedCount++;
        logger.info('[FixRequiresLogin] Fixed recent RawLog with content', {
          rawLogId: rawLog.id,
          contentLength: rawLog.contentLen,
          title: title.substring(0, 50),
          createdAt: rawLog.createdAt
        });
      }
    }

    // 5. RawLog에서도 중복 수집으로 인한 잘못된 requiresLogin 수정
    const duplicateRawLogs = query(`
      SELECT json_extract(metadata, '$.externalPostId') as postId,
             COUNT(*) as cnt,
             SUM(CASE WHEN json_extract(metadata, '$.requiresLogin') = true THEN 1 ELSE 0 END) as loginCount,
             SUM(CASE WHEN json_extract(metadata, '$.requiresLogin') = false OR json_extract(metadata, '$.requiresLogin') IS NULL THEN 1 ELSE 0 END) as normalCount
      FROM RawLog
      WHERE source = 'naver'
        AND json_extract(metadata, '$.externalPostId') IS NOT NULL
      GROUP BY postId
      HAVING cnt > 1 AND loginCount > 0 AND normalCount > 0
    `);

    logger.info('[FixRequiresLogin] Found duplicate RawLogs with mixed requiresLogin', {
      count: duplicateRawLogs.length
    });

    for (const dup of duplicateRawLogs) {
      // 같은 externalPostId를 가진 모든 RawLog 조회
      const rawLogs = query(
        `SELECT id, metadata, content, length(content) as contentLen 
         FROM RawLog 
         WHERE json_extract(metadata, '$.externalPostId') = ? 
         ORDER BY createdAt DESC`,
        [dup.postId]
      );

      // 본문이 가장 긴 RawLog를 기준으로 결정
      const bestLog = rawLogs.reduce((best, current) => {
        if (!best) return current;
        return current.contentLen > best.contentLen ? current : best;
      });

      const bestMeta = JSON.parse(bestLog.metadata || '{}');
      const targetRequiresLogin = bestLog.contentLen >= 50 ? false : bestMeta.requiresLogin;

      for (const rawLog of rawLogs) {
        const meta = JSON.parse(rawLog.metadata || '{}');
        if (meta.requiresLogin !== targetRequiresLogin) {
          meta.requiresLogin = targetRequiresLogin;
          execute(
            'UPDATE RawLog SET metadata = ?, updatedAt = ? WHERE id = ?',
            [JSON.stringify(meta), new Date().toISOString(), rawLog.id]
          );
          fixedCount++;
          logger.info('[FixRequiresLogin] Fixed duplicate RawLog requiresLogin', {
            rawLogId: rawLog.id,
            postId: dup.postId,
            oldRequiresLogin: meta.requiresLogin,
            newRequiresLogin: targetRequiresLogin,
            contentLength: rawLog.contentLen
          });
        }
      }
    }

    logger.info('[FixRequiresLogin] Fix completed', {
      totalFixed: fixedCount
    });

    console.log('\n✅ 잘못된 로그인 필요 표시 수정 완료');
    console.log(`  수정된 항목: ${fixedCount}개`);

  } catch (error) {
    logger.error('[FixRequiresLogin] Fix failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  const args = process.argv.slice(2);
  const recentOnly = args.includes('--recent');
  const hoursMatch = args.find(arg => arg.startsWith('--hours='));
  const hours = hoursMatch ? parseInt(hoursMatch.split('=')[1]) : 24;

  fixIncorrectRequiresLogin({ recentOnly, hours })
    .then(() => {
      logger.info('[FixRequiresLogin] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[FixRequiresLogin] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { fixIncorrectRequiresLogin };

