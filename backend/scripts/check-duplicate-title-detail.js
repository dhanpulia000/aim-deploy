const { query } = require('../libs/db');

const issues = query(`
  SELECT 
    id, 
    summary, 
    detail,
    length(summary) as summaryLen,
    length(detail) as detailLen,
    sourceUrl,
    createdAt 
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND summary IS NOT NULL
    AND detail IS NOT NULL
    AND summary != ''
    AND detail != ''
  ORDER BY createdAt DESC 
  LIMIT 50
`);

console.log('=== 최근 게시글 제목/본문 비교 ===\n');

let sameCount = 0;
let detailStartsWithSummaryCount = 0;
let summaryStartsWithDetailCount = 0;
let differentCount = 0;

issues.forEach((issue, idx) => {
  const isSame = issue.summary === issue.detail;
  const detailStartsWithSummary = issue.detail && issue.detail.startsWith(issue.summary);
  const summaryStartsWithDetail = issue.summary && issue.summary.startsWith(issue.detail);
  
  let comparison = 'different';
  if (isSame) {
    comparison = 'same';
    sameCount++;
  } else if (detailStartsWithSummary) {
    comparison = 'detail_starts_with_summary';
    detailStartsWithSummaryCount++;
  } else if (summaryStartsWithDetail) {
    comparison = 'summary_starts_with_detail';
    summaryStartsWithDetailCount++;
  } else {
    differentCount++;
  }
  
  if (isSame || detailStartsWithSummary || summaryStartsWithDetail) {
    console.log(`[${idx + 1}] ${issue.summary?.substring(0, 60) || 'N/A'}`);
    console.log(`   제목 길이: ${issue.summaryLen || 0}자`);
    console.log(`   본문 길이: ${issue.detailLen || 0}자`);
    console.log(`   비교 결과: ${comparison}`);
    if (isSame) {
      console.log(`   ⚠️ 제목과 본문이 동일함`);
      console.log(`   제목/본문: "${issue.summary}"`);
    } else if (detailStartsWithSummary) {
      console.log(`   ⚠️ 본문이 제목으로 시작함`);
      console.log(`   제목: "${issue.summary}"`);
      console.log(`   본문 시작: "${issue.detail.substring(0, Math.min(issue.summary.length + 50, issue.detail.length))}"`);
    } else if (summaryStartsWithDetail) {
      console.log(`   ⚠️ 제목이 본문으로 시작함`);
      console.log(`   제목: "${issue.summary}"`);
      console.log(`   본문: "${issue.detail.substring(0, 100)}"`);
    }
    console.log(`   생성일: ${issue.createdAt}`);
    console.log(`   URL: ${issue.sourceUrl?.substring(0, 100) || 'N/A'}`);
    console.log('');
  }
});

console.log('=== 통계 ===');
console.log(`전체: ${issues.length}개`);
console.log(`제목=본문 (완전 동일): ${sameCount}개`);
console.log(`본문이 제목으로 시작: ${detailStartsWithSummaryCount}개`);
console.log(`제목이 본문으로 시작: ${summaryStartsWithDetailCount}개`);
console.log(`다름: ${differentCount}개`);

