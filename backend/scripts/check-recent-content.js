const { query } = require('../libs/db');

const issues = query(`
  SELECT 
    id, 
    summary, 
    requiresLogin, 
    CASE 
      WHEN detail IS NULL OR detail = '' THEN 'empty' 
      ELSE 'has_content' 
    END as detailStatus, 
    length(detail) as detailLen, 
    sourceUrl, 
    createdAt 
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
  ORDER BY createdAt DESC 
  LIMIT 30
`);

console.log('=== 최근 게시글 본문 수집 상태 ===\n');

let emptyCount = 0;
let hasContentCount = 0;
let requiresLoginCount = 0;

issues.forEach((issue, idx) => {
  const isEmpty = issue.detailStatus === 'empty';
  if (isEmpty) emptyCount++;
  else hasContentCount++;
  if (issue.requiresLogin) requiresLoginCount++;
  
  console.log(`[${idx + 1}] ${issue.summary?.substring(0, 60) || 'N/A'}`);
  console.log(`   본문: ${issue.detailStatus} (${issue.detailLen || 0}자)`);
  console.log(`   requiresLogin: ${issue.requiresLogin ? 'Yes' : 'No'}`);
  console.log(`   생성일: ${issue.createdAt}`);
  console.log(`   URL: ${issue.sourceUrl?.substring(0, 100) || 'N/A'}`);
  console.log('');
});

console.log('=== 통계 ===');
console.log(`전체: ${issues.length}개`);
console.log(`본문 있음: ${hasContentCount}개`);
console.log(`본문 없음: ${emptyCount}개`);
console.log(`로그인 필요: ${requiresLoginCount}개`);

