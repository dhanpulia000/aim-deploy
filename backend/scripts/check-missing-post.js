const { query, queryOne } = require('../libs/db');

// "컴린이 질문드립니다" 게시글 검색
console.log('=== "컴린이 질문드립니다" 게시글 검색 ===\n');

// 1. ReportItemIssue에서 검색
const issues = query(`
  SELECT id, summary, sourceUrl, externalPostId, createdAt, isHotTopic, commentCount
  FROM ReportItemIssue
  WHERE summary LIKE '%컴린이%' OR summary LIKE '%질문%'
  ORDER BY createdAt DESC
  LIMIT 20
`);

console.log('1. ReportItemIssue 검색 결과:');
if (issues.length === 0) {
  console.log('  - 이슈로 등록된 게시글이 없습니다.\n');
} else {
  issues.forEach(issue => {
    console.log(`  - ID: ${issue.id}, 제목: ${issue.summary?.substring(0, 50)}`);
    console.log(`    URL: ${issue.sourceUrl}`);
    console.log(`    생성일: ${issue.createdAt}`);
    console.log(`    댓글수: ${issue.commentCount || 0}, 핫토픽: ${issue.isHotTopic ? 'Yes' : 'No'}\n`);
  });
}

// 2. RawLog에서 검색 (metadata JSON에서 title 추출)
const rawLogs = query(`
  SELECT id, json_extract(metadata, '$.title') as title, json_extract(metadata, '$.url') as url, 
         articleId, boardId, createdAt, isProcessed, content
  FROM RawLog
  WHERE source = 'naver' 
    AND (json_extract(metadata, '$.title') LIKE '%컴린이%' OR json_extract(metadata, '$.title') LIKE '%질문%')
  ORDER BY createdAt DESC
  LIMIT 20
`);

console.log('2. RawLog 검색 결과:');
if (rawLogs.length === 0) {
  console.log('  - RawLog에 저장된 게시글이 없습니다.\n');
} else {
  rawLogs.forEach(log => {
    console.log(`  - ID: ${log.id}, 제목: ${log.title?.substring(0, 50)}`);
    console.log(`    URL: ${log.url}`);
    console.log(`    articleId: ${log.articleId}, boardId: ${log.boardId}`);
    console.log(`    생성일: ${log.createdAt}, 처리됨: ${log.isProcessed ? 'Yes' : 'No'}`);
    console.log(`    본문 미리보기: ${log.content?.substring(0, 100) || '(없음)'}\n`);
  });
}

// 3. 키워드 목록 확인
const keywords = query(`
  SELECT word, enabled, type
  FROM MonitoringKeyword
  WHERE type = 'naver'
  ORDER BY enabled DESC, word
`);

console.log('3. 모니터링 키워드 목록:');
if (keywords.length === 0) {
  console.log('  - 키워드가 설정되어 있지 않습니다. (모든 게시글이 수집됩니다)\n');
} else {
  const enabledKeywords = keywords.filter(k => k.enabled);
  const disabledKeywords = keywords.filter(k => !k.enabled);
  
  console.log(`  - 활성화된 키워드 (${enabledKeywords.length}개):`);
  enabledKeywords.forEach(k => {
    console.log(`    * ${k.word}`);
  });
  
  if (disabledKeywords.length > 0) {
    console.log(`\n  - 비활성화된 키워드 (${disabledKeywords.length}개):`);
    disabledKeywords.forEach(k => {
      console.log(`    * ${k.word}`);
    });
  }
  console.log('');
}

// 4. 제외 게시판 확인
const excludedBoardsConfig = queryOne(`
  SELECT * FROM MonitoringConfig WHERE key = 'naver.excludedBoards'
`);

console.log('4. 제외 게시판 설정:');
if (excludedBoardsConfig) {
  try {
    const excluded = JSON.parse(excludedBoardsConfig.value);
    if (Array.isArray(excluded) && excluded.length > 0) {
      console.log(`  - 제외 게시판: ${excluded.join(', ')}\n`);
    } else {
      console.log('  - 제외 게시판 없음\n');
    }
  } catch (e) {
    console.log(`  - 설정 파싱 실패: ${e.message}\n`);
  }
} else {
  console.log('  - 제외 게시판 설정 없음 (기본값 사용: 가입인사, 등업신청, 자유게시판)\n');
}

// 5. 모니터링 중인 게시판 확인
const boards = query(`
  SELECT id, name, lastScanAt, lastArticleId, enabled, isActive
  FROM MonitoredBoard
  WHERE cafeGame = 'PUBG' OR name LIKE '%PUBG%' OR name LIKE '%배그%'
  ORDER BY name
`);

console.log('5. 모니터링 중인 게시판:');
boards.forEach(board => {
  console.log(`  - ${board.name} (ID: ${board.id})`);
  console.log(`    활성화: ${board.enabled ? 'Yes' : 'No'}, 활성: ${board.isActive ? 'Yes' : 'No'}`);
  console.log(`    마지막 스캔: ${board.lastScanAt || '없음'}`);
  console.log(`    마지막 articleId: ${board.lastArticleId || '없음'}\n`);
});

// 6. 키워드 매칭 테스트
function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return true;
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  const normalizedKeywords = keywords.map(k => String(k).toLowerCase().trim()).filter(k => k.length > 0);
  if (normalizedKeywords.length === 0) return true;
  
  return normalizedKeywords.some(keyword => {
    const normalizedKeyword = keyword.replace(/\s+/g, '');
    const normalizedText = lowerText.replace(/\s+/g, '');
    return normalizedText.includes(normalizedKeyword);
  });
}

const testTitle = '컴린이 질문드립니다';
const enabledKeywordList = keywords.filter(k => k.enabled).map(k => k.word.toLowerCase());

console.log('5. 키워드 매칭 테스트:');
console.log(`  테스트 제목: "${testTitle}"`);
console.log(`  활성화된 키워드: ${enabledKeywordList.length > 0 ? enabledKeywordList.join(', ') : '없음'}`);
const matches = matchesKeywords(testTitle, enabledKeywordList);
console.log(`  매칭 결과: ${matches ? '✅ 통과' : '❌ 필터링됨'}\n`);

if (!matches && enabledKeywordList.length > 0) {
  console.log('  ⚠️  이 게시글이 수집되지 않은 이유: 키워드 필터링에 걸렸습니다.');
  console.log('      제목에 활성화된 키워드가 포함되어 있지 않습니다.\n');
}

process.exit(0);

