const { PrismaClient } = require('@prisma/client');
const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const prisma = new PrismaClient();
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_NOTICE_USER_IDS = (process.env.SLACK_NOTICE_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const SLACK_NOTICE_USER_NAMES = process.env.SLACK_NOTICE_USER_NAMES || '';

// 환경 변수에서 매핑 파싱
let userNamesMap = new Map();
if (SLACK_NOTICE_USER_NAMES) {
  try {
    // JSON 형식 시도
    const jsonMap = JSON.parse(SLACK_NOTICE_USER_NAMES);
    if (typeof jsonMap === 'object' && !Array.isArray(jsonMap)) {
      Object.entries(jsonMap).forEach(([id, name]) => {
        userNamesMap.set(id.trim(), String(name).trim());
      });
      console.log(`환경 변수에서 ${userNamesMap.size}개의 사용자 이름 매핑을 로드했습니다.`);
    }
  } catch (jsonError) {
    // JSON 파싱 실패 시 쉼표로 구분된 형식 시도: "U12345:홍길동,U67890:김철수"
    const pairs = SLACK_NOTICE_USER_NAMES.split(',')
      .map(pair => pair.trim())
      .filter(Boolean);
    
    pairs.forEach(pair => {
      const [id, name] = pair.split(':').map(s => s.trim());
      if (id && name) {
        userNamesMap.set(id, name);
      }
    });
    
    if (userNamesMap.size > 0) {
      console.log(`환경 변수에서 ${userNamesMap.size}개의 사용자 이름 매핑을 로드했습니다.`);
    }
  }
}

/**
 * Slack 사용자 ID로 이름 조회
 */
async function getUserName(client, userId) {
  if (!userId) return null;
  
  // 1. 환경 변수에서 설정된 매핑 확인
  if (userNamesMap.has(userId)) {
    return userNamesMap.get(userId);
  }
  
  // 2. Slack API로 조회 (client가 있는 경우)
  if (!client) return null;
  
  try {
    const info = await client.users.info({ user: userId });
    if (info.ok && info.user) {
      const name = info.user.real_name || info.user.profile?.display_name || info.user.name;
      if (name) {
        return name;
      }
    }
  } catch (error) {
    console.warn(`Failed to fetch user info for ${userId}:`, error.message);
  }
  return null;
}

async function main() {
  try {
    console.log('=== 슬랙 고객사 피드백 공지 담당자명 수정 시작 ===\n');
    
    if (!SLACK_BOT_TOKEN) {
      console.error('SLACK_BOT_TOKEN이 설정되지 않았습니다.');
      process.exit(1);
    }
    
    const client = new WebClient(SLACK_BOT_TOKEN);
    
    // managerName이 ID 형식(U로 시작)이거나 "알 수 없음"인 공지 찾기
    const noticesWithId = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker',
        OR: [
          { managerName: { startsWith: 'U' } },
          { managerName: '알 수 없음' }
        ]
      },
      select: {
        id: true,
        managerName: true,
        createdAt: true
      }
    });
    
    console.log(`총 ${noticesWithId.length}개의 공지에서 수정이 필요한 담당자명을 발견했습니다.\n`);
    
    if (noticesWithId.length === 0) {
      console.log('수정할 공지가 없습니다.');
      await prisma.$disconnect();
      return;
    }
    
    let fixedCount = 0;
    let failedCount = 0;
    
    // "알 수 없음"인 항목 처리: SLACK_NOTICE_USER_IDS에 단일 사용자만 있고 매핑이 있으면 해당 이름으로 변경
    let defaultUserName = null;
    if (SLACK_NOTICE_USER_IDS.length === 1 && userNamesMap.size === 1) {
      const singleUserId = SLACK_NOTICE_USER_IDS[0];
      if (userNamesMap.has(singleUserId)) {
        defaultUserName = userNamesMap.get(singleUserId);
        console.log(`단일 사용자 감지: ${singleUserId} → ${defaultUserName}`);
        console.log(`"알 수 없음" 항목들을 "${defaultUserName}"으로 변경합니다.\n`);
      }
    }
    
    for (const notice of noticesWithId) {
      let userId = notice.managerName;
      
      // "알 수 없음"인 경우 처리
      if (userId === '알 수 없음') {
        if (defaultUserName) {
          // 단일 사용자이고 매핑이 있으면 해당 이름으로 변경
          await prisma.customerFeedbackNotice.update({
            where: { id: notice.id },
            data: { managerName: defaultUserName }
          });
          fixedCount++;
          console.log(`[수정] ID: ${notice.id}, "알 수 없음" → ${defaultUserName} (단일 사용자 매핑)`);
        } else {
          // 원본 사용자 ID를 찾을 수 없고 매핑도 없으면 스킵
          console.log(`[스킵] ID: ${notice.id}, "알 수 없음" - 원본 사용자 ID를 찾을 수 없습니다.`);
        }
        continue;
      }
      
      // Slack 사용자 ID로 이름 조회 (환경 변수 매핑 우선, 그 다음 API)
      const userName = await getUserName(client, userId);
      
      if (userName) {
        // 이름으로 업데이트
        await prisma.customerFeedbackNotice.update({
          where: { id: notice.id },
          data: { managerName: userName }
        });
        
        fixedCount++;
        console.log(`[수정] ID: ${notice.id}, ${userId} → ${userName}`);
      } else {
        // 이름을 찾지 못한 경우에도 환경 변수에 매핑이 있으면 사용
        if (userNamesMap.has(userId)) {
          const mappedName = userNamesMap.get(userId);
          await prisma.customerFeedbackNotice.update({
            where: { id: notice.id },
            data: { managerName: mappedName }
          });
          fixedCount++;
          console.log(`[수정] ID: ${notice.id}, ${userId} → ${mappedName} (환경 변수 매핑)`);
        } else {
          // 이름을 찾지 못한 경우 "알 수 없음"으로 변경
          await prisma.customerFeedbackNotice.update({
            where: { id: notice.id },
            data: { managerName: '알 수 없음' }
          });
          
          failedCount++;
          console.log(`[수정] ID: ${notice.id}, ${userId} → 알 수 없음 (이름 조회 실패)`);
        }
      }
      
      // API 레이트 리밋 방지
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\n=== 수정 완료 ===`);
    console.log(`총 ${fixedCount}개의 공지를 이름으로 수정했습니다.`);
    console.log(`총 ${failedCount}개의 공지를 "알 수 없음"으로 변경했습니다.`);
    
  } catch (err) {
    console.error('오류 발생:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();

