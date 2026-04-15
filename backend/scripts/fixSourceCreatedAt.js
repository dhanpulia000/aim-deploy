/**
 * sourceCreatedAt 시간 수정 스크립트
 * 
 * 이전 버그로 인해 sourceCreatedAt이 9시간 빠르게 저장된 경우를 수정합니다.
 * createKSTDate의 결과를 이중 변환하여 9시간을 또 빼버린 경우를 수정합니다.
 * 
 * 사용법:
 *   node scripts/fixSourceCreatedAt.js [옵션]
 * 
 * 옵션:
 *   --dry-run: 실제 수정하지 않고 확인만 수행
 *   --days=N: 최근 N일 이내의 이슈만 수정 (기본값: 7)
 *   --add-hours=N: 추가할 시간(시간 단위, 기본값: 9)
 */

const { query, execute } = require('../libs/db');
const path = require('path');

// 명령줄 인자 파싱
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const daysArg = args.find(arg => arg.startsWith('--days='));
const hoursArg = args.find(arg => arg.startsWith('--add-hours='));

const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
const addHours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 9;

console.log('='.repeat(60));
console.log('sourceCreatedAt 시간 수정 스크립트');
console.log('='.repeat(60));
console.log(`모드: ${isDryRun ? 'DRY-RUN (실제 수정 안 함)' : '실제 수정'}`);
console.log(`기간: 최근 ${days}일 이내`);
console.log(`수정: sourceCreatedAt에 ${addHours}시간 추가`);
console.log('='.repeat(60));
console.log('');

// 수정 대상 이슈 조회
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - days);
const cutoffISO = cutoffDate.toISOString();

const targetIssues = query(`
  SELECT 
    id,
    summary,
    sourceCreatedAt,
    createdAt,
    source
  FROM ReportItemIssue
  WHERE sourceCreatedAt IS NOT NULL
    AND sourceCreatedAt >= ?
    AND (source LIKE 'NAVER_CAFE%' OR source = 'naver')
  ORDER BY createdAt DESC
`, [cutoffISO]);

console.log(`수정 대상 이슈 수: ${targetIssues.length}개\n`);

if (targetIssues.length === 0) {
  console.log('수정할 이슈가 없습니다.');
  process.exit(0);
}

// 샘플 확인 (최대 5개)
console.log('샘플 확인 (최대 5개):');
console.log('-'.repeat(60));
targetIssues.slice(0, 5).forEach(issue => {
  const oldUTC = new Date(issue.sourceCreatedAt);
  const oldKST = oldUTC.toLocaleString('ko-KR');
  const newUTC = new Date(oldUTC.getTime() + (addHours * 60 * 60 * 1000));
  const newKST = newUTC.toLocaleString('ko-KR');
  
  console.log(`ID: ${issue.id.substring(0, 8)}...`);
  console.log(`  Summary: ${issue.summary?.substring(0, 40)}`);
  console.log(`  현재 (UTC): ${oldUTC.toISOString()}`);
  console.log(`  현재 (KST): ${oldKST}`);
  console.log(`  수정 후 (UTC): ${newUTC.toISOString()}`);
  console.log(`  수정 후 (KST): ${newKST}`);
  console.log('');
});

if (isDryRun) {
  console.log('='.repeat(60));
  console.log('DRY-RUN 모드: 실제 수정하지 않았습니다.');
  console.log('실제 수정하려면 --dry-run 옵션을 제거하세요.');
  process.exit(0);
}

// 실제 수정
console.log('='.repeat(60));
console.log('수정 시작...');
console.log('='.repeat(60));

let updatedCount = 0;
let errorCount = 0;

targetIssues.forEach((issue, index) => {
  try {
    const oldUTC = new Date(issue.sourceCreatedAt);
    const newUTC = new Date(oldUTC.getTime() + (addHours * 60 * 60 * 1000));
    const newISO = newUTC.toISOString();
    
    execute(`
      UPDATE ReportItemIssue
      SET sourceCreatedAt = ?,
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newISO, issue.id]);
    
    updatedCount++;
    
    if ((index + 1) % 100 === 0) {
      console.log(`진행 중... ${index + 1}/${targetIssues.length} (${updatedCount}개 수정)`);
    }
  } catch (error) {
    console.error(`오류 발생 (ID: ${issue.id}):`, error.message);
    errorCount++;
  }
});

console.log('');
console.log('='.repeat(60));
console.log('수정 완료!');
console.log('='.repeat(60));
console.log(`총 수정: ${updatedCount}개`);
if (errorCount > 0) {
  console.log(`오류: ${errorCount}개`);
}
console.log('');

// 수정 결과 확인
const sampleIds = targetIssues.slice(0, 5).map(i => i.id);
const verifyIssues = query(`
  SELECT 
    id,
    summary,
    sourceCreatedAt,
    createdAt
  FROM ReportItemIssue
  WHERE id IN (${sampleIds.map(() => '?').join(',')})
  ORDER BY createdAt DESC
  LIMIT 5
`, sampleIds);

console.log('수정 결과 확인 (샘플 5개):');
console.log('-'.repeat(60));
verifyIssues.forEach(issue => {
  const sourceUTC = new Date(issue.sourceCreatedAt);
  const sourceKST = sourceUTC.toLocaleString('ko-KR');
  const createdKST = new Date(issue.createdAt).toLocaleString('ko-KR');
  
  console.log(`ID: ${issue.id.substring(0, 8)}...`);
  console.log(`  Summary: ${issue.summary?.substring(0, 40)}`);
  console.log(`  SourceCreatedAt (KST): ${sourceKST}`);
  console.log(`  CreatedAt (KST): ${createdKST}`);
  console.log('');
});

console.log('완료!');

