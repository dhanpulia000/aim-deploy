const { query } = require('../libs/db');

// "고번 유추" 게시글 찾기
const issues = query(`
  SELECT 
    id, 
    summary, 
    detail,
    length(detail) as detailLen,
    sourceUrl,
    externalPostId
  FROM ReportItemIssue 
  WHERE summary LIKE '%고번 유추%' 
  ORDER BY createdAt DESC 
  LIMIT 5
`);

console.log('=== "고번 유추" 게시글 검색 ===\n');

issues.forEach((issue, idx) => {
  console.log(`[${idx + 1}] ${issue.summary}`);
  console.log(`   detail: ${issue.detail || '(없음)'} (${issue.detailLen || 0}자)`);
  console.log(`   externalPostId: ${issue.externalPostId}`);
  console.log(`   URL: ${issue.sourceUrl}`);
  console.log('');
  
  // RawLog 확인
  if (issue.externalPostId) {
    const rawLogs = query(`
      SELECT 
        id,
        content,
        length(content) as contentLen,
        metadata,
        createdAt
      FROM RawLog 
      WHERE metadata LIKE ? 
      ORDER BY createdAt DESC 
      LIMIT 3
    `, [`%${issue.externalPostId}%`]);
    
    console.log(`   RawLog (${rawLogs.length}개):`);
    rawLogs.forEach((log, logIdx) => {
      let metadata = null;
      try {
        metadata = log.metadata ? JSON.parse(log.metadata) : null;
      } catch (e) {
        // JSON 파싱 실패 무시
      }
      
      console.log(`     [${logIdx + 1}] content: ${log.content?.substring(0, 100) || '(없음)'} (${log.contentLen || 0}자)`);
      if (metadata) {
        console.log(`         metadata.title: ${metadata.title?.substring(0, 50) || 'N/A'}`);
        console.log(`         metadata.externalPostId: ${metadata.externalPostId || 'N/A'}`);
        console.log(`         metadata.requiresLogin: ${metadata.requiresLogin ? 'Yes' : 'No'}`);
      }
      console.log(`         createdAt: ${log.createdAt}`);
      console.log('');
    });
  }
});

// 최근 게시글 중 본문이 매우 짧은 게시글 확인
console.log('\n=== 최근 게시글 중 본문이 20자 이하인 게시글 ===\n');

const shortContentIssues = query(`
  SELECT 
    id, 
    summary, 
    detail,
    length(detail) as detailLen,
    sourceUrl,
    externalPostId,
    createdAt
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND length(detail) > 0 
    AND length(detail) <= 20
  ORDER BY createdAt DESC 
  LIMIT 10
`);

shortContentIssues.forEach((issue, idx) => {
  console.log(`[${idx + 1}] ${issue.summary?.substring(0, 60) || 'N/A'}`);
  console.log(`   detail: "${issue.detail}" (${issue.detailLen}자)`);
  console.log(`   createdAt: ${issue.createdAt}`);
  console.log('');
});

