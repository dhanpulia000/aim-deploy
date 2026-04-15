const { query } = require('../libs/db');

// 본문이 없거나 placeholder인 최근 게시글 확인
const issues = query(`
  SELECT 
    id, 
    summary, 
    detail,
    length(detail) as detailLen,
    sourceUrl,
    createdAt
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND (detail = '[이미지/미디어 포함]' OR detail IS NULL OR detail = '')
  ORDER BY createdAt DESC 
  LIMIT 20
`);

console.log('=== 본문 없이 저장된 최근 게시글 ===\n');

issues.forEach((issue, idx) => {
  console.log(`[${idx + 1}] ${issue.summary?.substring(0, 60) || 'N/A'}`);
  console.log(`   detail: "${issue.detail || '(없음)'}" (${issue.detailLen || 0}자)`);
  console.log(`   createdAt: ${issue.createdAt}`);
  console.log(`   URL: ${issue.sourceUrl?.substring(0, 100) || 'N/A'}`);
  console.log('');
});





