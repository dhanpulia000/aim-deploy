const { query } = require('../libs/db');

// 최근 게시글의 실제 본문 내용 확인
const issues = query(`
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
    AND createdAt > datetime('now', '-1 hour')
  ORDER BY createdAt DESC 
  LIMIT 10
`);

console.log('=== 최근 1시간 내 크롤링된 게시글 본문 확인 ===\n');

issues.forEach((issue, idx) => {
  console.log(`[${idx + 1}] ${issue.summary?.substring(0, 60) || 'N/A'}`);
  console.log(`   detail: "${issue.detail || '(없음)'}" (${issue.detailLen || 0}자)`);
  console.log(`   externalPostId: ${issue.externalPostId}`);
  console.log(`   createdAt: ${issue.createdAt}`);
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
      LIMIT 1
    `, [`%${issue.externalPostId}%`]);
    
    if (rawLogs.length > 0) {
      const log = rawLogs[0];
      let metadata = null;
      try {
        metadata = log.metadata ? JSON.parse(log.metadata) : null;
      } catch (e) {
        // JSON 파싱 실패 무시
      }
      
      console.log(`   RawLog content: "${log.content?.substring(0, 200) || '(없음)'}" (${log.contentLen || 0}자)`);
      if (metadata && metadata.title) {
        console.log(`   RawLog title: ${metadata.title?.substring(0, 60)}`);
      }
      console.log('');
    }
  }
});





