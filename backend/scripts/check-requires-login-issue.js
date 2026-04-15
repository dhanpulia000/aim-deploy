const { query } = require('../libs/db');

console.log('=== "고번 유추" 게시글 검색 ===\n');

const issues = query(`
  SELECT 
    id, 
    summary, 
    requiresLogin, 
    detail, 
    length(detail) as detailLen, 
    sourceUrl,
    createdAt
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND (summary LIKE '%고번%' OR summary LIKE '%유추%')
  ORDER BY createdAt DESC 
  LIMIT 5
`);

if (issues.length === 0) {
  console.log('해당 게시글을 찾을 수 없습니다.\n');
} else {
  issues.forEach((issue, idx) => {
    console.log(`[${idx + 1}] ${issue.summary?.substring(0, 50) || 'N/A'}`);
    console.log(`   requiresLogin: ${issue.requiresLogin ? 'Yes' : 'No'}`);
    console.log(`   본문 길이: ${issue.detailLen || 0}자`);
    console.log(`   본문 미리보기: ${issue.detail?.substring(0, 100) || '(없음)'}`);
    console.log(`   URL: ${issue.sourceUrl}`);
    console.log(`   생성일: ${issue.createdAt}\n`);
  });
}

// 본문이 있는데 로그인 필요로 표시된 게시글 확인
const falsePositive = query(`
  SELECT 
    id, 
    summary, 
    requiresLogin, 
    detail, 
    length(detail) as detailLen
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND requiresLogin = 1 
    AND length(detail) > 30
    AND detail != summary
  ORDER BY createdAt DESC 
  LIMIT 10
`);

console.log('\n=== 본문이 있는데 로그인 필요로 표시된 게시글 (잘못된 판단 가능성) ===');
if (falsePositive.length === 0) {
  console.log('없습니다.\n');
} else {
  console.log(`⚠️  ${falsePositive.length}개 발견\n`);
  falsePositive.forEach((issue, idx) => {
    console.log(`[${idx + 1}] ${issue.summary?.substring(0, 50) || 'N/A'}`);
    console.log(`   본문 길이: ${issue.detailLen || 0}자`);
    console.log(`   본문 미리보기: ${issue.detail?.substring(0, 150) || '(없음)'}\n`);
  });
}

process.exit(0);





