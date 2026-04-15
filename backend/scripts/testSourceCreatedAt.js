// 원본 작성 시간 표기 테스트 스크립트
const { query } = require('../libs/db');

async function testSourceCreatedAt() {
  console.log('\n=== 원본 작성 시간 표기 테스트 ===\n');
  
  // 최근 수집된 이슈 조회 (최근 30개)
  const issues = query(`
    SELECT 
      id,
      summary,
      sourceCreatedAt,
      createdAt,
      requiresLogin,
      source
    FROM ReportItemIssue 
    WHERE sourceCreatedAt IS NOT NULL 
    ORDER BY createdAt DESC 
    LIMIT 30
  `);
  
  if (issues.length === 0) {
    console.log('수집된 이슈가 없습니다.');
    return;
  }
  
  console.log(`총 ${issues.length}개의 이슈를 확인합니다.\n`);
  console.log('='.repeat(100));
  console.log(
    '요약'.padEnd(50) + 
    ' | 타입'.padEnd(8) + 
    ' | 로그인필요'.padEnd(10) + 
    ' | 원본작성시간(KST)'.padEnd(20) + 
    ' | 수집시간(KST)'.padEnd(20)
  );
  console.log('='.repeat(100));
  
  let problemCount = 0;
  let normalCount = 0;
  const problemIssues = [];
  
  issues.forEach(issue => {
    const sourceDate = new Date(issue.sourceCreatedAt);
    const createdDate = new Date(issue.createdAt);
    
    // KST로 변환하여 시간 확인
    const sourceKST = sourceDate.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const createdKST = createdDate.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // 원본 작성 시간이 00:00:00인지 확인
    const hour = sourceDate.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const isProblem = hour === '오전 12:00:00' || hour === '00:00:00';
    
    if (isProblem) {
      problemCount++;
      problemIssues.push({
        id: issue.id,
        summary: issue.summary,
        sourceCreatedAt: sourceKST,
        requiresLogin: issue.requiresLogin,
        source: issue.source
      });
    } else {
      normalCount++;
    }
    
    const shortSummary = (issue.summary || '').substring(0, 48).padEnd(48);
    const type = (issue.source || 'N/A').substring(0, 6).padEnd(6);
    const login = issue.requiresLogin ? 'Y' : 'N';
    const status = isProblem ? '⚠️' : '✓';
    
    console.log(
      `${status} ${shortSummary} | ${type} | ${login.padEnd(8)} | ${sourceKST.padEnd(18)} | ${createdKST}`
    );
  });
  
  console.log('='.repeat(100));
  console.log(`\n결과 요약:`);
  console.log(`  정상: ${normalCount}개`);
  console.log(`  문제 (00:00:00): ${problemCount}개`);
  
  if (problemIssues.length > 0) {
    console.log(`\n⚠️ 문제가 있는 이슈 상세:`);
    problemIssues.slice(0, 10).forEach((issue, idx) => {
      console.log(`\n${idx + 1}. ID: ${issue.id}`);
      console.log(`   제목: ${issue.summary}`);
      console.log(`   원본 작성 시간: ${issue.sourceCreatedAt}`);
      console.log(`   로그인 필요: ${issue.requiresLogin ? 'Y' : 'N'}`);
      console.log(`   소스: ${issue.source}`);
    });
    
    if (problemIssues.length > 10) {
      console.log(`\n... 외 ${problemIssues.length - 10}개`);
    }
    
    // 로그인 필요 여부별 통계
    const loginRequired = problemIssues.filter(i => i.requiresLogin).length;
    const loginNotRequired = problemIssues.filter(i => !i.requiresLogin).length;
    
    console.log(`\n문제 이슈 분석:`);
    console.log(`  로그인 필요: ${loginRequired}개`);
    console.log(`  일반: ${loginNotRequired}개`);
  }
  
  console.log('\n');
}

testSourceCreatedAt().catch(error => {
  console.error('오류 발생:', error);
  process.exit(1);
});

