const { query, queryOne, execute, db, executeTransaction } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * [이미지/미디어 포함] 으로 저장된 Naver 이슈들의 detail을 RawLog 기반으로 복원하는 스크립트
 *
 * 사용법:
 *   node scripts/backfill-naver-detail.js 3   // 최근 3일
 */

const BATCH_SIZE = 100; // 배치 처리 크기

/**
 * RawLog에서 매칭되는 항목 찾기 (json_extract 사용하여 성능 최적화)
 * @param {string|null} externalPostId - 외부 게시글 ID
 * @param {string|null} sourceUrl - 소스 URL
 * @returns {Object|null} 매칭된 RawLog 행 또는 null
 */
function findMatchingRawlog(externalPostId, sourceUrl) {
  // externalPostId로 검색
  if (externalPostId) {
    try {
      const raws = query(
        `
        SELECT id, content, metadata, createdAt
        FROM RawLog
        WHERE source = 'naver'
          AND json_extract(metadata, '$.externalPostId') = ?
        ORDER BY createdAt DESC
        LIMIT 5
        `,
        [String(externalPostId)]
      );

      for (const raw of raws) {
        try {
          const meta = raw.metadata ? JSON.parse(raw.metadata) : {};
          const metaPostId = meta.externalPostId || null;
          if (metaPostId && String(metaPostId) === String(externalPostId)) {
            return raw;
          }
        } catch (e) {
          logger.debug('[Backfill] Failed to parse RawLog metadata (externalPostId)', {
            rawId: raw.id,
            error: e.message,
          });
        }
      }
    } catch (e) {
      // SQLite 버전이 낮거나 JSON 함수 미지원 시 fallback
      logger.warn('[Backfill] json_extract 사용 실패, LIKE 검색으로 fallback', {
        error: e.message,
        externalPostId,
      });
      
      // Fallback to LIKE search for older SQLite versions
      const raws = query(
        `
        SELECT id, content, metadata, createdAt
        FROM RawLog
        WHERE source = 'naver'
          AND metadata LIKE ?
        ORDER BY createdAt DESC
        LIMIT 20
        `,
        [`%"externalPostId":"${externalPostId}"%`]
      );

      for (const raw of raws) {
        try {
          const meta = raw.metadata ? JSON.parse(raw.metadata) : {};
          const metaPostId = meta.externalPostId || null;
          if (metaPostId && String(metaPostId) === String(externalPostId)) {
            return raw;
          }
        } catch (parseError) {
          logger.debug('[Backfill] Failed to parse RawLog metadata (LIKE fallback)', {
            rawId: raw.id,
            error: parseError.message,
          });
        }
      }
    }
  }

  // sourceUrl로 검색
  if (sourceUrl) {
    try {
      const raws = query(
        `
        SELECT id, content, metadata, createdAt
        FROM RawLog
        WHERE source = 'naver'
          AND json_extract(metadata, '$.url') = ?
        ORDER BY createdAt DESC
        LIMIT 5
        `,
        [String(sourceUrl)]
      );

      for (const raw of raws) {
        try {
          const meta = raw.metadata ? JSON.parse(raw.metadata) : {};
          const metaUrl = meta.url || null;
          if (metaUrl && String(metaUrl) === String(sourceUrl)) {
            return raw;
          }
        } catch (e) {
          logger.debug('[Backfill] Failed to parse RawLog metadata (sourceUrl)', {
            rawId: raw.id,
            error: e.message,
          });
        }
      }
    } catch (e) {
      logger.warn('[Backfill] json_extract 사용 실패, LIKE 검색으로 fallback', {
        error: e.message,
        sourceUrl,
      });
      
      // Fallback to LIKE search
      const raws = query(
        `
        SELECT id, content, metadata, createdAt
        FROM RawLog
        WHERE source = 'naver'
          AND metadata LIKE ?
        ORDER BY createdAt DESC
        LIMIT 20
        `,
        [`%"url":"${sourceUrl}"%`]
      );

      for (const raw of raws) {
        try {
          const meta = raw.metadata ? JSON.parse(raw.metadata) : {};
          const metaUrl = meta.url || null;
          if (metaUrl && String(metaUrl) === String(sourceUrl)) {
            return raw;
          }
        } catch (parseError) {
          logger.debug('[Backfill] Failed to parse RawLog metadata (LIKE fallback)', {
            rawId: raw.id,
            error: parseError.message,
          });
        }
      }
    }
  }

  return null;
}

/**
 * 이슈 목록을 처리하고 업데이트할 데이터를 수집
 * @param {Array} issues - 처리할 이슈 목록
 * @returns {Object} 처리 결과 통계 및 업데이트 배치
 */
function processIssues(issues) {
  let updated = 0;
  let skippedNoRaw = 0;
  let skippedNoContent = 0;
  let errorCount = 0;
  const updateBatch = []; // [{ detail, id }, ...]

  for (let idx = 0; idx < issues.length; idx++) {
    const issue = issues[idx];
    const { id, summary, externalPostId, sourceUrl } = issue;

    try {
      logger.info(`[${idx + 1}/${issues.length}] 이슈 처리: ${id} | ${summary?.substring(0, 40) || ''}`);

      if (!externalPostId && !sourceUrl) {
        logger.warn('  ⚠️ externalPostId와 sourceUrl이 모두 없습니다. 스킵합니다.');
        skippedNoRaw++;
        continue;
      }

      // RawLog 매칭
      const matchedRaw = findMatchingRawlog(externalPostId, sourceUrl);

      if (!matchedRaw) {
        logger.warn('  ❌ 매칭되는 RawLog를 찾지 못했습니다.');
        skippedNoRaw++;
        continue;
      }

      const rawContent = (matchedRaw.content || '').trim();
      if (!rawContent || rawContent === '[이미지/미디어 포함]') {
        logger.warn('  ⚠️ RawLog에도 유효한 본문이 없습니다.');
        skippedNoContent++;
        continue;
      }

      // 업데이트 배치에 추가
      updateBatch.push({
        detail: rawContent,
        id: id,
      });
      updated++;
      logger.info(`  ✅ detail 업데이트 예정 (RawLog ID: ${matchedRaw.id})`);
    } catch (error) {
      // 개별 아이템 처리 중 에러가 전체 프로세스를 중단시키지 않도록
      errorCount++;
      logger.error(`[${idx + 1}/${issues.length}] 이슈 처리 중 오류 발생`, {
        issueId: id,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  return {
    updated,
    skippedNoRaw,
    skippedNoContent,
    errorCount,
    updateBatch,
  };
}

/**
 * 배치 단위로 업데이트 실행
 * @param {Array} updateBatch - 업데이트할 데이터 목록
 * @returns {number} 에러 발생 건수
 */
function batchUpdate(updateBatch) {
  if (updateBatch.length === 0) {
    return 0;
  }

  let errorCount = 0;
  // Prepared statement는 트랜잭션 외부에서 미리 준비 (성능 최적화)
  const updateStmt = db.prepare('UPDATE ReportItemIssue SET detail = ?, updatedAt = datetime(\'now\') WHERE id = ?');

  // 배치 단위로 처리
  for (let i = 0; i < updateBatch.length; i += BATCH_SIZE) {
    const batch = updateBatch.slice(i, i + BATCH_SIZE);
    
    try {
      // 트랜잭션으로 배치 처리
      executeTransaction(() => {
        for (const item of batch) {
          updateStmt.run(item.detail, item.id);
        }
      });

      logger.info(`배치 커밋 완료: ${batch.length}개 업데이트 (전체 ${i + batch.length}/${updateBatch.length})`);
    } catch (error) {
      errorCount += batch.length;
      logger.error('배치 커밋 실패', {
        batchStart: i,
        batchSize: batch.length,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  return errorCount;
}

/**
 * 메인 함수
 */
function main() {
  const days = Number(process.argv[2] || '3');
  if (Number.isNaN(days) || days <= 0) {
    logger.error('❌ 일수는 1 이상의 숫자여야 합니다.');
    process.exit(1);
  }

  const now = new Date();
  const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]; // YYYY-MM-DD

  logger.info(`🛠 최근 ${days}일(${sinceDate} ~ 오늘) 동안의 이슈 중 [이미지/미디어 포함] 본문을 복원합니다.`);

  try {
    const issues = query(
      `
      SELECT id, summary, detail, externalPostId, sourceUrl, date, createdAt
      FROM ReportItemIssue
      WHERE detail = '[이미지/미디어 포함]'
        AND date >= ?
      ORDER BY createdAt DESC
      `,
      [sinceDate]
    );

    logger.info(`대상 이슈 수: ${issues.length}`);
    if (issues.length === 0) {
      logger.info('✅ 업데이트할 이슈가 없습니다.');
      process.exit(0);
    }

    // 이슈 처리 및 업데이트 데이터 수집
    const {
      updated,
      skippedNoRaw,
      skippedNoContent,
      errorCount: processErrorCount,
      updateBatch,
    } = processIssues(issues);

    // 배치 업데이트 실행
    const updateErrorCount = batchUpdate(updateBatch);

    // 결과 요약
    logger.info('\n' + '='.repeat(50));
    logger.info('결과 요약');
    logger.info('='.repeat(50));
    logger.info(`총 대상 이슈: ${issues.length}`);
    logger.info(`  ✅ 업데이트된 이슈: ${updated}`);
    logger.info(`  ❌ RawLog 매칭 실패: ${skippedNoRaw}`);
    logger.info(`  ⚠️ RawLog에 유효한 본문 없음: ${skippedNoContent}`);
    if (processErrorCount > 0) {
      logger.error(`  ❌ 이슈 처리 중 오류: ${processErrorCount}`);
    }
    if (updateErrorCount > 0) {
      logger.error(`  ❌ 업데이트 에러: ${updateErrorCount}`);
    }
    logger.info('='.repeat(50));

    logger.info('완료되었습니다.');
    process.exit(0);
  } catch (error) {
    logger.error('[Backfill] Failed to backfill naver detail', {
      error: error.message,
      stack: error.stack,
    });
    console.error('❌ 오류 발생:', error.message);
    process.exit(1);
  }
}

main();









