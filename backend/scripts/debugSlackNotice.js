/**
 * 슬랙 공지 수집 디버깅 스크립트
 * 최근 슬랙 메시지를 가져와서 필터링 로직을 테스트합니다.
 */

require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const logger = require('../utils/logger');

// 필터링 함수들 (워커와 동일)
const SLACK_NOTICE_USER_IDS = (process.env.SLACK_NOTICE_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

function isNoticeMessage(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // "공지" 키워드 확인
  if (lowerText.includes('공지') || lowerText.includes('알림') || lowerText.includes('공지사항')) {
    return true;
  }
  
  // 공지 이모지 확인
  if (text.includes('📢') || text.includes('🔔') || text.includes('📣')) {
    return true;
  }
  
  return false;
}

function isNoticeAuthor(userId) {
  if (!userId) return false;
  if (!SLACK_NOTICE_USER_IDS.length) {
    return true; // 설정이 없으면 모든 작성자 허용
  }
  return SLACK_NOTICE_USER_IDS.includes(userId);
}

async function debugSlackMessages() {
  try {
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
    const SLACK_NOTICE_CHANNEL_ID = process.env.SLACK_NOTICE_CHANNEL_ID;

    console.log('=== 슬랙 공지 수집 디버깅 ===\n');

    // 설정 확인
    console.log('설정 확인:');
    console.log(`  SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN ? '✅ 설정됨' : '❌ 설정 안 됨'}`);
    console.log(`  SLACK_NOTICE_CHANNEL_ID: ${SLACK_NOTICE_CHANNEL_ID || '❌ 설정 안 됨'}`);
    console.log(`  SLACK_NOTICE_USER_IDS: ${SLACK_NOTICE_USER_IDS.length > 0 ? SLACK_NOTICE_USER_IDS.join(', ') : '❌ 설정 안 됨 (모든 작성자 허용)'}`);
    console.log('');

    if (!SLACK_BOT_TOKEN || !SLACK_NOTICE_CHANNEL_ID) {
      console.log('❌ 필수 설정이 누락되었습니다.');
      return;
    }

    const client = new WebClient(SLACK_BOT_TOKEN);

    // 최근 24시간 메시지 가져오기
    const oldest = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    console.log('최근 24시간 메시지 조회 중...\n');

    const historyResult = await client.conversations.history({
      channel: SLACK_NOTICE_CHANNEL_ID,
      oldest: oldest.toString(),
      limit: 50
    });

    if (!historyResult.ok) {
      console.log(`❌ 메시지 조회 실패: ${historyResult.error}`);
      return;
    }

    const messages = historyResult.messages || [];
    console.log(`총 ${messages.length}개의 메시지를 가져왔습니다.\n`);

    // 각 메시지 분석
    let collectedCount = 0;
    let skippedCount = 0;

    for (const message of messages.reverse()) {
      // 봇 메시지 스킵
      if (message.subtype || message.bot_id) {
        continue;
      }

      const messageText = message.text || '';
      const userId = message.user;
      const ts = message.ts;
      const createdAt = message.ts ? new Date(parseFloat(message.ts) * 1000) : new Date();

      console.log(`\n[메시지 분석]`);
      console.log(`  시간: ${createdAt.toLocaleString('ko-KR')}`);
      console.log(`  작성자 ID: ${userId || '없음'}`);
      console.log(`  내용: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);

      // 작성자 필터 확인
      const authorPassed = isNoticeAuthor(userId);
      console.log(`  작성자 필터: ${authorPassed ? '✅ 통과' : '❌ 차단'}`);
      
      if (!authorPassed) {
        console.log(`    → 작성자 ID가 허용 목록에 없습니다.`);
        skippedCount++;
        continue;
      }

      // 내용 필터 확인
      let contentPassed = true;
      if (!SLACK_NOTICE_USER_IDS.length) {
        contentPassed = isNoticeMessage(messageText);
        console.log(`  내용 필터: ${contentPassed ? '✅ 통과' : '❌ 차단'}`);
        
        if (!contentPassed) {
          console.log(`    → 메시지에 공지 키워드나 이모지가 없습니다.`);
          console.log(`    → 필요한 키워드: "공지", "알림", "공지사항" 또는 이모지: 📢, 🔔, 📣`);
          skippedCount++;
          continue;
        }
      } else {
        console.log(`  내용 필터: ✅ 통과 (작성자 필터가 설정되어 있어 내용 필터 생략)`);
      }

      console.log(`  → ✅ 이 메시지는 수집됩니다!`);
      collectedCount++;
    }

    console.log(`\n=== 결과 요약 ===`);
    console.log(`  수집 가능: ${collectedCount}개`);
    console.log(`  스킵됨: ${skippedCount}개`);
    console.log(`  총 메시지: ${messages.length}개`);

    if (collectedCount === 0) {
      console.log(`\n⚠️  수집 가능한 메시지가 없습니다.`);
      console.log(`\n해결 방법:`);
      if (SLACK_NOTICE_USER_IDS.length > 0) {
        console.log(`  1. 작성한 사용자의 Slack User ID가 SLACK_NOTICE_USER_IDS에 포함되어 있는지 확인`);
        console.log(`  2. 또는 SLACK_NOTICE_USER_IDS를 비워두고 메시지에 공지 키워드를 포함`);
      } else {
        console.log(`  1. 메시지에 "공지", "알림", "공지사항" 키워드를 포함하거나`);
        console.log(`  2. 📢, 🔔, 📣 이모지를 사용하거나`);
        console.log(`  3. SLACK_NOTICE_USER_IDS에 작성자 ID를 추가`);
      }
    }

  } catch (error) {
    console.error('오류 발생:', error.message);
    console.error(error.stack);
  }
}

debugSlackMessages();









