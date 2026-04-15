/**
 * 대기 중인 RawLog 확인 스크립트
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne } = require('../libs/db');

async function checkPendingRawLogs() {
  console.log('=== 대기 중인 RawLog 확인 ===\n');

  // 전체 통계
  const stats = queryOne(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN isProcessed = 0 THEN 1 END) as pending,
      COUNT(CASE WHEN isProcessed = 1 THEN 1 END) as processed
    FROM RawLog
  `);
  
  console.log('전체 통계:');
  console.log(`  전체: ${stats.total}개`);
  console.log(`  처리 완료: ${stats.processed}개`);
  console.log(`  대기 중: ${stats.pending}개\n`);

  // 처리 상태별 통계
  const statusStats = query(`
    SELECT 
      processingStatus,
      COUNT(*) as count,
      COUNT(CASE WHEN isProcessed = 0 THEN 1 END) as pending_count
    FROM RawLog
    WHERE isProcessed = 0
    GROUP BY processingStatus
    ORDER BY count DESC
  `);

  console.log('처리 상태별 대기 중인 RawLog:');
  statusStats.forEach(stat => {
    console.log(`  ${stat.processingStatus || 'NULL'}: ${stat.count}개`);
  });
  console.log('');

  // 대기 중인 RawLog 상세 정보
  const pendingLogs = query(`
    SELECT 
      id,
      source,
      processingStatus,
      attempts,
      lockedAt,
      nextRetryAt,
      lastError,
      createdAt,
      updatedAt
    FROM RawLog
    WHERE isProcessed = 0
    ORDER BY createdAt DESC
    LIMIT 20
  `);

  console.log(`대기 중인 RawLog 상세 (최대 20개):`);
  console.log('ID | 소스 | 상태 | 시도 횟수 | 락 시간 | 다음 재시도 | 에러 | 생성 시간');
  console.log('-'.repeat(100));
  
  pendingLogs.forEach(log => {
    const lockedAt = log.lockedAt ? new Date(log.lockedAt).toLocaleString('ko-KR') : 'NULL';
    const nextRetryAt = log.nextRetryAt ? new Date(log.nextRetryAt).toLocaleString('ko-KR') : 'NULL';
    const createdAt = log.createdAt ? new Date(log.createdAt).toLocaleString('ko-KR') : 'NULL';
    const error = log.lastError ? log.lastError.substring(0, 50) + '...' : 'NULL';
    
    console.log(`${log.id.substring(0, 8)}... | ${log.source || 'NULL'} | ${log.processingStatus || 'NULL'} | ${log.attempts || 0} | ${lockedAt} | ${nextRetryAt} | ${error} | ${createdAt}`);
  });

  // 에러가 있는 RawLog
  const errorLogs = query(`
    SELECT 
      id,
      source,
      processingStatus,
      attempts,
      lastError,
      createdAt
    FROM RawLog
    WHERE isProcessed = 0 AND lastError IS NOT NULL
    ORDER BY attempts DESC, createdAt DESC
    LIMIT 10
  `);

  if (errorLogs.length > 0) {
    console.log('\n에러가 있는 RawLog (최대 10개):');
    errorLogs.forEach(log => {
      console.log(`\n  ID: ${log.id}`);
      console.log(`  소스: ${log.source || 'NULL'}`);
      console.log(`  상태: ${log.processingStatus || 'NULL'}`);
      console.log(`  시도 횟수: ${log.attempts || 0}`);
      console.log(`  에러: ${log.lastError}`);
      console.log(`  생성 시간: ${log.createdAt ? new Date(log.createdAt).toLocaleString('ko-KR') : 'NULL'}`);
    });
  }

  // PROCESSING 상태로 오래 머물러 있는 RawLog (타임아웃 가능성)
  const stuckLogs = query(`
    SELECT 
      id,
      source,
      processingStatus,
      lockedAt,
      createdAt,
      updatedAt,
      (julianday('now') - julianday(lockedAt)) * 24 * 60 as minutes_stuck
    FROM RawLog
    WHERE isProcessed = 0 
      AND processingStatus = 'PROCESSING'
      AND lockedAt IS NOT NULL
      AND (julianday('now') - julianday(lockedAt)) * 24 * 60 > 5
    ORDER BY lockedAt ASC
    LIMIT 10
  `);

  if (stuckLogs.length > 0) {
    console.log('\nPROCESSING 상태로 오래 머물러 있는 RawLog (5분 이상, 최대 10개):');
    stuckLogs.forEach(log => {
      console.log(`\n  ID: ${log.id}`);
      console.log(`  소스: ${log.source || 'NULL'}`);
      console.log(`  락 시간: ${log.lockedAt ? new Date(log.lockedAt).toLocaleString('ko-KR') : 'NULL'}`);
      console.log(`  멈춘 시간: ${Math.round(log.minutes_stuck)}분`);
      console.log(`  생성 시간: ${log.createdAt ? new Date(log.createdAt).toLocaleString('ko-KR') : 'NULL'}`);
    });
  }
}

checkPendingRawLogs().catch(console.error);


