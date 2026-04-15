const { queryOne } = require('../libs/db');

// 게시판 이름 정규화 함수 (워커와 동일)
function normalizeBoardName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .trim();
}

// 제외 게시판 목록 로드
const config = queryOne("SELECT * FROM MonitoringConfig WHERE key = 'naver.excludedBoards'");
const excluded = config ? JSON.parse(config.value) : ['가입인사', '등업신청', '자유게시판'];

// 테스트 게시판 이름
const testBoardName = 'PUBG PC 질문/응답 게시판';
const normTest = normalizeBoardName(testBoardName);

console.log('=== 게시판 이름 필터링 테스트 ===\n');
console.log(`테스트 게시판: "${testBoardName}"`);
console.log(`정규화된 이름: "${normTest}"`);
console.log(`\n제외 게시판 목록 (${excluded.length}개):`);

let matched = false;
excluded.forEach(ex => {
  const normEx = normalizeBoardName(ex);
  const match1 = normTest.includes(normEx);
  const match2 = normEx.includes(normTest);
  const isMatch = match1 || match2;
  
  if (isMatch) {
    matched = true;
    console.log(`  ⚠️  "${ex}" (정규화: "${normEx}")`);
    console.log(`     매칭됨! normTest.includes(normEx): ${match1}, normEx.includes(normTest): ${match2}`);
  } else {
    console.log(`  ✓ "${ex}" (정규화: "${normEx}")`);
  }
});

console.log(`\n결과: ${matched ? '❌ 제외됨 (수집 안됨)' : '✅ 통과 (수집됨)'}`);

// 추가 테스트: "질문" 또는 "응답"이 포함된 제외 게시판이 있는지 확인
console.log('\n=== "질문" 또는 "응답" 키워드 포함 여부 확인 ===');
const questionRelated = excluded.filter(ex => 
  ex.includes('질문') || ex.includes('응답') || ex.includes('Q&A') || ex.includes('QnA')
);
if (questionRelated.length > 0) {
  console.log('⚠️  "질문" 또는 "응답"이 포함된 제외 게시판:');
  questionRelated.forEach(ex => console.log(`  - ${ex}`));
} else {
  console.log('✓ "질문" 또는 "응답"이 포함된 제외 게시판 없음');
}

process.exit(0);





