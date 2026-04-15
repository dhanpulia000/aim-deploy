/**
 * 슬랙 워커 상태 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function checkSlackWorkerStatus() {
  try {
    console.log('=== 슬랙 워커 상태 확인 ===\n');

    // 환경 변수 확인
    console.log('1. 환경 변수 확인:');
    console.log(`   SLACK_BOT_TOKEN: ${process.env.SLACK_BOT_TOKEN ? '✅ 설정됨' : '❌ 미설정'}`);
    console.log(`   SLACK_NOTICE_CHANNEL_ID: ${process.env.SLACK_NOTICE_CHANNEL_ID || '❌ 미설정'}`);
    console.log(`   SLACK_NOTICE_USER_IDS: ${process.env.SLACK_NOTICE_USER_IDS || '❌ 미설정'}`);
    console.log(`   SLACK_NOTICE_USER_NAMES: ${process.env.SLACK_NOTICE_USER_NAMES || '❌ 미설정'}`);
    console.log(`   SLACK_NOTICE_SCAN_INTERVAL_MS: ${process.env.SLACK_NOTICE_SCAN_INTERVAL_MS || '기본값 (10분)'}\n`);

    // 최근 공지사항 확인
    const recentNotices = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker'
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        gameName: true,
        managerName: true,
        content: true,
        screenshotPath: true,
        createdAt: true
      }
    });

    console.log('2. 최근 공지사항 (최근 5개):');
    if (recentNotices.length === 0) {
      console.log('   ⚠️  공지사항이 없습니다.\n');
    } else {
      recentNotices.forEach((notice, index) => {
        const timeAgo = Math.floor((Date.now() - new Date(notice.createdAt).getTime()) / 1000 / 60);
        console.log(`   [${index + 1}] ID: ${notice.id}`);
        console.log(`       게임명: ${notice.gameName}`);
        console.log(`       작성자: ${notice.managerName}`);
        console.log(`       내용: ${notice.content?.substring(0, 40)}${notice.content?.length > 40 ? '...' : ''}`);
        console.log(`       이미지: ${notice.screenshotPath ? '✅ 있음' : '❌ 없음'}`);
        console.log(`       생성 시간: ${new Date(notice.createdAt).toLocaleString('ko-KR')} (${timeAgo}분 전)`);
        console.log('');
      });
    }

    // 통계
    const totalNotices = await prisma.customerFeedbackNotice.count({
      where: {
        createdBy: 'slack_worker'
      }
    });

    const noticesWithImage = await prisma.customerFeedbackNotice.count({
      where: {
        createdBy: 'slack_worker',
        screenshotPath: { not: null }
      }
    });

    const todayNotices = await prisma.customerFeedbackNotice.count({
      where: {
        createdBy: 'slack_worker',
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    });

    console.log('3. 통계:');
    console.log(`   총 공지사항: ${totalNotices}개`);
    console.log(`   오늘 생성된 공지: ${todayNotices}개`);
    console.log(`   이미지가 있는 공지: ${noticesWithImage}개\n`);

    // 워커 실행 여부 추정
    if (recentNotices.length > 0) {
      const latestNotice = recentNotices[0];
      const minutesSinceLastNotice = Math.floor((Date.now() - new Date(latestNotice.createdAt).getTime()) / 1000 / 60);
      const scanInterval = parseInt(process.env.SLACK_NOTICE_SCAN_INTERVAL_MS) || 600000; // 기본 10분
      const scanIntervalMinutes = scanInterval / 60000;

      console.log('4. 워커 상태 추정:');
      console.log(`   마지막 공지 생성: ${minutesSinceLastNotice}분 전`);
      console.log(`   스캔 주기: ${scanIntervalMinutes}분`);
      
      if (minutesSinceLastNotice < scanIntervalMinutes * 2) {
        console.log(`   상태: ✅ 워커가 최근에 실행된 것으로 보입니다.`);
      } else {
        console.log(`   상태: ⚠️  워커가 오래 전에 실행된 것으로 보입니다.`);
        console.log(`   확인: 백엔드 서버 로그에서 [SlackNoticeWorker] 메시지를 확인하세요.`);
      }
    } else {
      console.log('4. 워커 상태 추정:');
      console.log(`   상태: ⚠️  공지사항이 없어 워커 실행 여부를 확인할 수 없습니다.`);
      console.log(`   확인: 백엔드 서버 로그에서 [SlackNoticeWorker] 메시지를 확인하세요.`);
    }

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkSlackWorkerStatus();









