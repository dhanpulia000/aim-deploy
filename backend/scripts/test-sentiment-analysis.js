/**
 * 센티멘트 분석 테스트 스크립트
 */

require('dotenv').config();
const { analyzeSentimentWithAI } = require('../services/aiIssueClassifier');

async function testSentimentAnalysis() {
  console.log('=== 센티멘트 분석 테스트 ===\n');

  const testTexts = [
    {
      text: '이 게임 버그가 너무 많아요. 개선해주세요.',
      expected: 'neg'
    },
    {
      text: '업데이트 감사합니다! 정말 좋아요.',
      expected: 'pos'
    },
    {
      text: '이벤트 일정은 언제인가요?',
      expected: 'neu'
    },
    {
      text: '핵 유저가 너무 많아서 게임하기 힘들어요. 제재 좀 해주세요.',
      expected: 'neg'
    },
    {
      text: '최근 업데이트로 프레임이 개선되었습니다.',
      expected: 'pos'
    }
  ];

  for (const testCase of testTexts) {
    console.log(`테스트 텍스트: "${testCase.text.substring(0, 50)}..."`);
    console.log(`예상 결과: ${testCase.expected}`);
    
    try {
      const result = await analyzeSentimentWithAI({ text: testCase.text });
      if (result && result.sentiment) {
        const isCorrect = result.sentiment === testCase.expected;
        console.log(`실제 결과: ${result.sentiment} ${isCorrect ? '✅' : '❌'}`);
        if (result.reason) {
          console.log(`이유: ${result.reason.substring(0, 100)}`);
        }
      } else {
        console.log('❌ 분석 결과 없음');
      }
    } catch (error) {
      console.log(`❌ 에러: ${error.message}`);
    }
    console.log('');
    
    // API 호출 제한 고려
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('=== 테스트 완료 ===');
}

if (require.main === module) {
  testSentimentAnalysis().catch(error => {
    console.error('테스트 실패:', error);
    process.exit(1);
  });
}

module.exports = { testSentimentAnalysis };











