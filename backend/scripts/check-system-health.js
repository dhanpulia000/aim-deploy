/**
 * 시스템 건강 상태 점검 스크립트
 * 크롤러, 이슈 승격, 데이터 무결성 등 전체 시스템 상태 확인
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');

async function checkSystemHealth() {
  const issues = [];
  const warnings = [];
  const info = [];

  console.log('='.repeat(60));
  console.log('시스템 건강 상태 점검');
  console.log('='.repeat(60));
  console.log('');

  try {
    // 1. 데이터베이스 연결 확인
    console.log('[1/8] 데이터베이스 연결 확인...');
    try {
      const testQuery = query('SELECT 1 as test');
      if (testQuery && testQuery.length > 0) {
        info.push('✅ 데이터베이스 연결 정상');
      } else {
        issues.push('❌ 데이터베이스 연결 실패');
      }
    } catch (dbError) {
      issues.push(`❌ 데이터베이스 연결 오류: ${dbError.message}`);
    }

    // 2. 프로세스 상태 확인
    console.log('[2/8] 프로세스 상태 확인...');
    const { execSync } = require('child_process');
    try {
      const serverProcess = execSync('pgrep -f "node server.js"', { encoding: 'utf-8' }).trim();
      info.push(`✅ 서버 프로세스 실행 중 (PID: ${serverProcess})`);
    } catch (e) {
      issues.push('❌ 서버 프로세스 미실행');
    }

    try {
      const crawlerProcess = execSync('pgrep -f "naverCafe.worker.js"', { encoding: 'utf-8' }).trim();
      info.push(`✅ 메인 크롤러 실행 중 (PID: ${crawlerProcess})`);
    } catch (e) {
      issues.push('❌ 메인 크롤러 미실행');
    }

    try {
      const backfillProcess = execSync('pgrep -f "naverCafeBackfill.worker.js"', { encoding: 'utf-8' }).trim();
      info.push(`✅ 보조 크롤러 실행 중 (PID: ${backfillProcess})`);
    } catch (e) {
      warnings.push('⚠️  보조 크롤러 미실행 (선택적)');
    }

    try {
      const processorProcess = execSync('pgrep -f "rawLogProcessor.worker.js"', { encoding: 'utf-8' }).trim();
      info.push(`✅ RawLog Processor 실행 중 (PID: ${processorProcess})`);
    } catch (e) {
      issues.push('❌ RawLog Processor 미실행');
    }

    // 3. 포트 사용 확인
    console.log('[3/8] 포트 사용 확인...');
    try {
      const port8080 = execSync('lsof -ti:8080', { encoding: 'utf-8' }).trim();
      info.push(`✅ 포트 8080 사용 중 (PID: ${port8080})`);
    } catch (e) {
      issues.push('❌ 포트 8080 미사용');
    }

    // 4. 최근 에러 로그 확인
    console.log('[4/8] 최근 에러 로그 확인...');
    try {
      // 최근 처리 실패한 RawLog 확인
      const failedRawLogs = query(`
        SELECT id, source, lastError, attempts, updatedAt
        FROM RawLog
        WHERE processingStatus = 'FAILED'
          AND updatedAt > datetime('now', '-24 hours')
        ORDER BY updatedAt DESC
        LIMIT 10
      `);

      if (failedRawLogs.length > 0) {
        warnings.push(`⚠️  최근 24시간 내 처리 실패한 RawLog: ${failedRawLogs.length}개`);
        failedRawLogs.forEach(log => {
          warnings.push(`   - RawLog ID: ${log.id}, 에러: ${log.lastError?.substring(0, 100)}`);
        });
      } else {
        info.push('✅ 최근 24시간 내 처리 실패한 RawLog 없음');
      }

      // 최근 재시도 중인 RawLog 확인
      const retryingRawLogs = query(`
        SELECT id, source, attempts, lastError, updatedAt
        FROM RawLog
        WHERE processingStatus = 'PENDING'
          AND attempts > 0
          AND updatedAt > datetime('now', '-1 hour')
        ORDER BY attempts DESC, updatedAt DESC
        LIMIT 10
      `);

      if (retryingRawLogs.length > 0) {
        warnings.push(`⚠️  최근 1시간 내 재시도 중인 RawLog: ${retryingRawLogs.length}개`);
        retryingRawLogs.forEach(log => {
          warnings.push(`   - RawLog ID: ${log.id}, 시도 횟수: ${log.attempts}`);
        });
      }
    } catch (error) {
      issues.push(`❌ 에러 로그 확인 실패: ${error.message}`);
    }

    // 5. 데이터 무결성 확인
    console.log('[5/8] 데이터 무결성 확인...');
    try {
      // 제목과 본문이 동일한 Issue 확인
      const duplicateIssues = query(`
        SELECT COUNT(*) as count
        FROM ReportItemIssue
        WHERE source LIKE 'NAVER%'
          AND summary IS NOT NULL
          AND detail IS NOT NULL
          AND summary != ''
          AND detail != ''
          AND summary = detail
          AND updatedAt > datetime('now', '-24 hours')
      `);

      if (duplicateIssues[0].count > 0) {
        warnings.push(`⚠️  최근 24시간 내 제목=본문인 Issue: ${duplicateIssues[0].count}개`);
      } else {
        info.push('✅ 최근 24시간 내 제목=본문인 Issue 없음');
      }

      // requiresLogin이 true인데 본문이 있는 Issue 확인 (의심스러운 케이스)
      const suspiciousIssues = query(`
        SELECT COUNT(*) as count
        FROM ReportItemIssue
        WHERE source LIKE 'NAVER%'
          AND requiresLogin = 1
          AND detail IS NOT NULL
          AND detail != ''
          AND LENGTH(detail) > 10
          AND updatedAt > datetime('now', '-24 hours')
      `);

      if (suspiciousIssues[0].count > 0) {
        warnings.push(`⚠️  로그인 필요인데 본문이 긴 Issue: ${suspiciousIssues[0].count}개 (정상일 수 있음)`);
      }
    } catch (error) {
      issues.push(`❌ 데이터 무결성 확인 실패: ${error.message}`);
    }

    // 6. 최근 크롤러 활동 확인
    console.log('[6/8] 최근 크롤러 활동 확인...');
    try {
      // 최근 1시간 내 생성된 RawLog 확인
      const recentRawLogs = query(`
        SELECT COUNT(*) as count
        FROM RawLog
        WHERE source = 'naver'
          AND createdAt > datetime('now', '-1 hour')
      `);

      if (recentRawLogs[0].count > 0) {
        info.push(`✅ 최근 1시간 내 수집된 RawLog: ${recentRawLogs[0].count}개`);
      } else {
        warnings.push('⚠️  최근 1시간 내 수집된 RawLog 없음 (크롤러가 작동하지 않을 수 있음)');
      }

      // 최근 처리된 RawLog 확인
      const processedRawLogs = query(`
        SELECT COUNT(*) as count
        FROM RawLog
        WHERE source = 'naver'
          AND isProcessed = 1
          AND updatedAt > datetime('now', '-1 hour')
      `);

      if (processedRawLogs[0].count > 0) {
        info.push(`✅ 최근 1시간 내 처리된 RawLog: ${processedRawLogs[0].count}개`);
      } else {
        warnings.push('⚠️  최근 1시간 내 처리된 RawLog 없음 (Processor가 작동하지 않을 수 있음)');
      }
    } catch (error) {
      issues.push(`❌ 크롤러 활동 확인 실패: ${error.message}`);
    }

    // 7. 이슈 승격 확인
    console.log('[7/8] 이슈 승격 확인...');
    try {
      // 최근 생성된 Issue 확인
      const recentIssues = query(`
        SELECT COUNT(*) as count
        FROM ReportItemIssue
        WHERE source LIKE 'NAVER%'
          AND createdAt > datetime('now', '-1 hour')
      `);

      if (recentIssues[0].count > 0) {
        info.push(`✅ 최근 1시간 내 생성된 Issue: ${recentIssues[0].count}개`);
      }

      // 처리 대기 중인 RawLog 확인
      const pendingRawLogs = query(`
        SELECT COUNT(*) as count
        FROM RawLog
        WHERE source = 'naver'
          AND isProcessed = 0
          AND processingStatus = 'PENDING'
      `);

      if (pendingRawLogs[0].count > 100) {
        warnings.push(`⚠️  처리 대기 중인 RawLog: ${pendingRawLogs[0].count}개 (백로그 누적)`);
      } else if (pendingRawLogs[0].count > 0) {
        info.push(`ℹ️  처리 대기 중인 RawLog: ${pendingRawLogs[0].count}개`);
      } else {
        info.push('✅ 처리 대기 중인 RawLog 없음');
      }
    } catch (error) {
      issues.push(`❌ 이슈 승격 확인 실패: ${error.message}`);
    }

    // 8. 에러 통계
    console.log('[8/8] 에러 통계 확인...');
    try {
      // 최근 24시간 내 에러 발생한 RawLog
      const errorRawLogs = query(`
        SELECT COUNT(*) as count
        FROM RawLog
        WHERE lastError IS NOT NULL
          AND lastError != ''
          AND updatedAt > datetime('now', '-24 hours')
      `);

      if (errorRawLogs[0].count > 0) {
        warnings.push(`⚠️  최근 24시간 내 에러 발생한 RawLog: ${errorRawLogs[0].count}개`);
      } else {
        info.push('✅ 최근 24시간 내 에러 발생한 RawLog 없음');
      }
    } catch (error) {
      issues.push(`❌ 에러 통계 확인 실패: ${error.message}`);
    }

  } catch (error) {
    issues.push(`❌ 시스템 점검 중 오류 발생: ${error.message}`);
    logger.error('[SystemHealth] Check failed', { error: error.message, stack: error.stack });
  }

  // 결과 출력
  console.log('');
  console.log('='.repeat(60));
  console.log('점검 결과');
  console.log('='.repeat(60));
  console.log('');

  if (issues.length > 0) {
    console.log('🔴 심각한 문제:');
    issues.forEach(issue => console.log(`  ${issue}`));
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('🟡 경고:');
    warnings.forEach(warning => console.log(`  ${warning}`));
    console.log('');
  }

  if (info.length > 0) {
    console.log('🟢 정상:');
    info.forEach(item => console.log(`  ${item}`));
    console.log('');
  }

  // 최종 상태
  console.log('='.repeat(60));
  if (issues.length > 0) {
    console.log('❌ 시스템에 문제가 있습니다. 위의 심각한 문제를 해결해주세요.');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('⚠️  시스템은 작동 중이지만 경고 사항이 있습니다.');
    process.exit(0);
  } else {
    console.log('✅ 시스템이 정상적으로 작동 중입니다.');
    process.exit(0);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  checkSystemHealth()
    .catch((error) => {
      logger.error('[SystemHealth] Fatal error', {
        error: error.message,
        stack: error.stack
      });
      console.error('❌ 심각한 오류 발생:', error.message);
      process.exit(1);
    });
}

module.exports = { checkSystemHealth };




