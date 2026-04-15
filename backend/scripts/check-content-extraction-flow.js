const { query } = require('../libs/db');

// 가장 최근 게시글 확인
const latestIssue = query(`
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
  ORDER BY createdAt DESC 
  LIMIT 1
`);

if (latestIssue.length === 0) {
  console.log('최근 게시글 없음');
  process.exit(0);
}

const issue = latestIssue[0];
console.log('=== 가장 최근 게시글 ===\n');
console.log(`제목: ${issue.summary}`);
console.log(`본문: "${issue.detail || '(없음)'}" (${issue.detailLen || 0}자)`);
console.log(`externalPostId: ${issue.externalPostId}`);
console.log(`생성일: ${issue.createdAt}`);
console.log(`URL: ${issue.sourceUrl}`);
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
    
    console.log('=== RawLog ===');
    console.log(`content: "${log.content || '(없음)'}" (${log.contentLen || 0}자)`);
    if (metadata) {
      console.log(`metadata.title: ${metadata.title || 'N/A'}`);
      console.log(`metadata.externalPostId: ${metadata.externalPostId || 'N/A'}`);
      console.log(`metadata.requiresLogin: ${metadata.requiresLogin ? 'Yes' : 'No'}`);
      console.log(`metadata.hasImages: ${metadata.hasImages ? 'Yes' : 'No'}`);
    }
    console.log(`생성일: ${log.createdAt}`);
    console.log('');
    
    // Issue와 RawLog 비교
    console.log('=== 비교 ===');
    if (log.contentLen === 0 && issue.detailLen > 0) {
      console.log('⚠️ RawLog의 content는 비어있지만 Issue의 detail은 있음');
      console.log(`   → 제목이 본문으로 사용된 것으로 보임`);
    } else if (log.contentLen > 0 && issue.detailLen === 0) {
      console.log('⚠️ RawLog의 content는 있지만 Issue의 detail은 비어있음');
      console.log(`   → RawLogProcessor에서 본문이 제거된 것으로 보임`);
    } else if (log.contentLen === issue.detailLen) {
      console.log('✓ RawLog와 Issue의 본문 길이가 동일');
    } else {
      console.log(`⚠️ RawLog와 Issue의 본문 길이가 다름 (RawLog: ${log.contentLen}자, Issue: ${issue.detailLen}자)`);
    }
  } else {
    console.log('RawLog를 찾을 수 없음');
  }
}





