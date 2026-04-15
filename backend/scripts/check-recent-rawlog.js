const { query } = require('../libs/db');

const rawLogs = query(`
  SELECT 
    id, 
    source,
    content,
    length(content) as contentLen,
    metadata,
    createdAt
  FROM RawLog 
  WHERE source = 'naver'
  ORDER BY createdAt DESC 
  LIMIT 50
`);

console.log('=== 최근 RawLog 수집 상태 ===\n');

let requiresLoginCount = 0;
let hasContentCount = 0;

rawLogs.forEach((log, idx) => {
  let metadata = {};
  let requiresLogin = false;
  let title = null;
  
  if (log.metadata) {
    try {
      metadata = JSON.parse(log.metadata);
      requiresLogin = metadata.requiresLogin === true || metadata.requiresLogin === 'true' || metadata.requiresLogin === 1;
      title = metadata.title || null;
    } catch (e) {
      // JSON 파싱 실패 시 무시
    }
  }
  
  if (requiresLogin) requiresLoginCount++;
  if (log.contentLen > 0) hasContentCount++;
  
  console.log(`[${idx + 1}] ${title || log.content?.substring(0, 60) || 'N/A'}`);
  console.log(`   content: ${log.contentLen || 0}자`);
  console.log(`   requiresLogin: ${requiresLogin ? 'Yes' : 'No'}`);
  console.log(`   생성일: ${log.createdAt}`);
  if (log.contentLen > 0 && requiresLogin) {
    console.log(`   ⚠️ 본문이 있지만 requiresLogin=true로 표시됨`);
  }
  console.log('');
});

console.log('=== 통계 ===');
console.log(`전체: ${rawLogs.length}개`);
console.log(`본문 있음: ${hasContentCount}개`);
console.log(`로그인 필요: ${requiresLoginCount}개`);





