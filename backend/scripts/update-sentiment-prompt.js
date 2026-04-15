/**
 * DB에 저장된 sentiment_analysis 프롬프트를 최신 버전으로 업데이트
 */

require('dotenv').config();
const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');

// 개선된 프롬프트 (코드와 동일하게)
const updatedSystemPrompt = `당신은 게임 커뮤니티 게시글의 사용자 성향을 분석하는 전문가입니다.

게시글을 읽고 작성자의 감정과 태도를 분석하여 다음 중 하나로 분류하세요:

1. **긍정 (pos)**: 만족, 감사, 칭찬, 기대감, 즐거움 등의 긍정적 감정 표현

2. **부정 (neg)** - 다음 중 하나라도 해당하면 반드시 부정:
   - 불만, 비판, 분노, 실망, 좌절 등의 부정적 감정 표현
   - 문제 제기, 개선 요구, 항의, 불평
   - 버그/오류 신고
   - "~했으면 좋겠다", "~해주세요", "~개선", "~문제", "~버그", "~오류", "~불편", "~안됨" 등의 표현
   - 현재 상태에 대한 불만이나 요구사항 제시

3. **중립 (neu)** - 오직 다음 경우만 중립:
   - 객관적 정보 전달 (예: "업데이트 내역입니다", "이벤트 일정입니다")
   - 단순 질문 (예: "이벤트 언제 시작하나요?", "이 기능 어떻게 사용하나요?")
   - 감정 표현이 전혀 없는 순수 사실 나열
   - **주의: 질문이라도 불만이나 문제 제기가 포함되면 부정입니다**

**절대 규칙 (매우 중요):**
- 문제 제기, 불만, 개선 요구는 감정 표현이 약해도 반드시 부정(neg)으로 분류
- "~했으면 좋겠다", "~해주세요" 같은 요구사항은 현재 상태에 대한 불만이므로 부정
- 버그 신고, 오류 제기, 불편함 표현은 모두 부정
- 중립(neu)은 오직 객관적 정보나 단순 질문만 해당
- 애매한 경우는 부정(neg)으로 분류 (안전한 선택)

응답 형식:
{
  "sentiment": "pos" | "neg" | "neu",
  "reason": "판단 근거"
}`;

async function updateSentimentPrompt() {
  try {
    console.log('🔍 DB에서 sentiment_analysis 프롬프트 확인 중...\n');
    
    // 현재 프롬프트 확인
    const current = query(
      'SELECT name, displayName, version, substr(systemPrompt, 1, 200) as preview FROM AIPromptConfig WHERE name = ?',
      ['sentiment_analysis']
    );
    
    if (!current || current.length === 0) {
      console.log('❌ sentiment_analysis 프롬프트가 DB에 없습니다.');
      console.log('   마이그레이션을 실행하거나 관리자 페이지에서 프롬프트를 생성하세요.\n');
      return;
    }
    
    console.log('📋 현재 프롬프트 정보:');
    console.log(`   이름: ${current[0].name}`);
    console.log(`   표시명: ${current[0].displayName}`);
    console.log(`   버전: ${current[0].version}`);
    console.log(`   미리보기: ${current[0].preview}...\n`);
    
    // 프롬프트 업데이트
    console.log('🔄 프롬프트 업데이트 중...\n');
    
    const result = execute(
      `UPDATE AIPromptConfig 
       SET systemPrompt = ?, 
           version = version + 1,
           updatedAt = datetime('now')
       WHERE name = ?`,
      [updatedSystemPrompt, 'sentiment_analysis']
    );
    
    console.log(`   변경된 행 수: ${result.changes}\n`);
    
    // 업데이트 확인
    const updated = query(
      'SELECT name, displayName, version, substr(systemPrompt, 1, 200) as preview FROM AIPromptConfig WHERE name = ?',
      ['sentiment_analysis']
    );
    
    if (updated && updated.length > 0) {
      console.log('✅ 프롬프트 업데이트 완료!');
      console.log(`   새 버전: ${updated[0].version}`);
      console.log(`   미리보기: ${updated[0].preview}...\n`);
      console.log('💡 이제 성향 분석 버튼을 다시 눌러보세요!\n');
    } else {
      console.log('❌ 업데이트 확인 실패\n');
    }
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    logger.error('[UpdateSentimentPrompt] Failed', { error: error.message, stack: error.stack });
  }
}

// 실행
updateSentimentPrompt().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ 스크립트 실행 실패:', error);
  process.exit(1);
});

