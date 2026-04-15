const { query } = require('../libs/db');

console.log('=== 최근 수집된 게시글의 댓글 수 확인 ===\n');

// RawLog에서 최근 수집된 게시글 확인
const recentRawLogs = query(`
  SELECT 
    id,
    json_extract(metadata, '$.title') as title,
    json_extract(metadata, '$.commentCount') as commentCount,
    json_extract(metadata, '$.url') as url,
    createdAt
  FROM RawLog
  WHERE source = 'naver'
    AND json_extract(metadata, '$.commentCount') IS NOT NULL
  ORDER BY createdAt DESC
  LIMIT 20
`);

console.log('1. RawLog에서 최근 수집된 게시글 (댓글 수 포함):');
if (recentRawLogs.length === 0) {
  console.log('  - 댓글 수가 포함된 게시글이 없습니다.\n');
} else {
  recentRawLogs.forEach((r, idx) => {
    console.log(`\n  [${idx + 1}] ${r.title?.substring(0, 50) || 'N/A'}`);
    console.log(`      댓글수: ${r.commentCount || 0}`);
    console.log(`      URL: ${r.url}`);
    console.log(`      수집시간: ${r.createdAt}`);
  });
}

// ReportItemIssue에서 최근 이슈 확인
const recentIssues = query(`
  SELECT 
    id,
    summary,
    commentCount,
    sourceUrl,
    isHotTopic,
    createdAt
  FROM ReportItemIssue
  WHERE source LIKE 'NAVER%'
    AND commentCount IS NOT NULL
  ORDER BY createdAt DESC
  LIMIT 20
`);

console.log('\n\n2. ReportItemIssue에서 최근 이슈 (댓글 수 포함):');
if (recentIssues.length === 0) {
  console.log('  - 댓글 수가 포함된 이슈가 없습니다.\n');
} else {
  recentIssues.forEach((r, idx) => {
    console.log(`\n  [${idx + 1}] ${r.summary?.substring(0, 50) || 'N/A'}`);
    console.log(`      댓글수: ${r.commentCount || 0}`);
    console.log(`      핫토픽: ${r.isHotTopic ? 'Yes' : 'No'}`);
    console.log(`      URL: ${r.sourceUrl}`);
    console.log(`      생성시간: ${r.createdAt}`);
  });
}

// 댓글 수 통계
const stats = query(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN commentCount = 0 THEN 1 ELSE 0 END) as zeroCount,
    SUM(CASE WHEN commentCount > 0 AND commentCount < 10 THEN 1 ELSE 0 END) as lowCount,
    SUM(CASE WHEN commentCount >= 10 THEN 1 ELSE 0 END) as highCount,
    AVG(commentCount) as avgCount,
    MAX(commentCount) as maxCount
  FROM ReportItemIssue
  WHERE source LIKE 'NAVER%'
    AND createdAt >= datetime('now', '-7 days')
`);

console.log('\n\n3. 최근 7일간 댓글 수 통계:');
if (stats.length > 0) {
  const s = stats[0];
  console.log(`  총 이슈 수: ${s.total || 0}`);
  console.log(`  댓글 0개: ${s.zeroCount || 0} (${s.total > 0 ? ((s.zeroCount / s.total) * 100).toFixed(1) : 0}%)`);
  console.log(`  댓글 1-9개: ${s.lowCount || 0} (${s.total > 0 ? ((s.lowCount / s.total) * 100).toFixed(1) : 0}%)`);
  console.log(`  댓글 10개 이상: ${s.highCount || 0} (${s.total > 0 ? ((s.highCount / s.total) * 100).toFixed(1) : 0}%)`);
  console.log(`  평균 댓글 수: ${s.avgCount ? parseFloat(s.avgCount).toFixed(1) : 0}`);
  console.log(`  최대 댓글 수: ${s.maxCount || 0}`);
}

process.exit(0);





