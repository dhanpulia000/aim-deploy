const { query } = require('../libs/db');

// 제목과 본문이 동일한 Issue 찾기
const issues = query(`
  SELECT 
    id, 
    summary, 
    detail,
    externalPostId,
    sourceUrl,
    createdAt 
  FROM ReportItemIssue 
  WHERE source LIKE 'NAVER%' 
    AND summary IS NOT NULL
    AND detail IS NOT NULL
    AND summary != ''
    AND detail != ''
    AND summary = detail
  ORDER BY createdAt DESC 
  LIMIT 10
`);

console.log('=== 제목과 본문이 동일한 Issue 확인 ===\n');

for (const issue of issues) {
  console.log(`[Issue ID: ${issue.id}]`);
  console.log(`제목/본문: "${issue.summary}"`);
  console.log(`externalPostId: ${issue.externalPostId}`);
  console.log(`URL: ${issue.sourceUrl}`);
  console.log(`생성일: ${issue.createdAt}`);
  
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
      WHERE source = 'naver'
        AND json_extract(metadata, '$.externalPostId') = ?
      ORDER BY createdAt DESC
      LIMIT 3
    `, [issue.externalPostId]);
    
    if (rawLogs.length > 0) {
      console.log(`\n  [RawLog 발견: ${rawLogs.length}개]`);
      rawLogs.forEach((log, idx) => {
        let metadata = {};
        try {
          metadata = JSON.parse(log.metadata || '{}');
        } catch (e) {}
        
        console.log(`  RawLog ${idx + 1}:`);
        console.log(`    ID: ${log.id}`);
        console.log(`    content 길이: ${log.contentLen || 0}자`);
        console.log(`    content: "${log.content?.substring(0, 100) || '(없음)'}"`);
        console.log(`    metadata.title: "${metadata.title || '(없음)'}"`);
        console.log(`    생성일: ${log.createdAt}`);
      });
    } else {
      console.log(`  [RawLog 없음]`);
    }
  }
  
  console.log('\n---\n');
}





