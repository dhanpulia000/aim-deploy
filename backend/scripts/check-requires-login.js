const { query } = require('../libs/db');

console.log('=== 로그인 필요 게시글 판단 로직 확인 ===\n');

// 로그인 필요로 표시된 게시글 확인
const requiresLoginIssues = query(`
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
    AND requiresLogin = 1 
  ORDER BY createdAt DESC 
  LIMIT 10
`);

console.log('1. 로그인 필요로 표시된 게시글:');
if (requiresLoginIssues.length === 0) {
  console.log('  - 로그인 필요로 표시된 게시글이 없습니다.\n');
} else {
  requiresLoginIssues.forEach((issue, idx) => {
    console.log(`\n  [${idx + 1}] ${issue.summary?.substring(0, 50) || 'N/A'}`);
    console.log(`      requiresLogin: ${issue.requiresLogin}`);
    console.log(`      본문 길이: ${issue.detailLen || 0}자`);
    console.log(`      본문 미리보기: ${issue.detail?.substring(0, 100) || '(없음)'}`);
    console.log(`      URL: ${issue.sourceUrl}`);
    console.log(`      생성일: ${issue.createdAt}`);
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
    AND length(detail) > 50
  ORDER BY createdAt DESC 
  LIMIT 10
`);

console.log('\n\n2. 본문이 있는데 로그인 필요로 표시된 게시글 (잘못된 판단 가능성):');
if (falsePositive.length === 0) {
  console.log('  - 본문이 있는데 로그인 필요로 표시된 게시글이 없습니다.\n');
} else {
  console.log(`  ⚠️  ${falsePositive.length}개 발견\n`);
  falsePositive.forEach((issue, idx) => {
    console.log(`  [${idx + 1}] ${issue.summary?.substring(0, 50) || 'N/A'}`);
    console.log(`      본문 길이: ${issue.detailLen || 0}자`);
    console.log(`      본문 미리보기: ${issue.detail?.substring(0, 150) || '(없음)'}\n`);
  });
}

// 본문이 없는데 로그인 필요로 표시되지 않은 게시글 확인
const falseNegative = query(`
  SELECT 
    id, 
    summary, 
    requiresLogin, 
    detail, 
    length(detail) as detailLen,
    sourceUrl
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND requiresLogin = 0 
    AND (detail IS NULL OR detail = '' OR length(detail) < 10)
    AND summary NOT LIKE '%[이미지/미디어 포함]%'
  ORDER BY createdAt DESC 
  LIMIT 10
`);

console.log('\n\n3. 본문이 없는데 로그인 필요로 표시되지 않은 게시글 (누락 가능성):');
if (falseNegative.length === 0) {
  console.log('  - 본문이 없는데 로그인 필요로 표시되지 않은 게시글이 없습니다.\n');
} else {
  console.log(`  ⚠️  ${falseNegative.length}개 발견\n`);
  falseNegative.forEach((issue, idx) => {
    console.log(`  [${idx + 1}] ${issue.summary?.substring(0, 50) || 'N/A'}`);
    console.log(`      requiresLogin: ${issue.requiresLogin}`);
    console.log(`      본문 길이: ${issue.detailLen || 0}자`);
    console.log(`      URL: ${issue.sourceUrl}\n`);
  });
}

process.exit(0);





