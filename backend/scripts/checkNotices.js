/**
 * 공지사항 수집 상태 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function checkNotices() {
  try {
    console.log('=== 공지사항 수집 상태 확인 ===\n');

    // 최근 10개 공지사항 조회
    const notices = await prisma.customerFeedbackNotice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        gameName: true,
        managerName: true,
        category: true,
        content: true,
        screenshotPath: true,
        noticeDate: true,
        createdAt: true,
        createdBy: true
      }
    });

    console.log(`총 공지사항 수: ${notices.length}개\n`);

    if (notices.length === 0) {
      console.log('⚠️  공지사항이 없습니다.');
      console.log('\n확인 사항:');
      console.log('1. SLACK_BOT_TOKEN이 설정되어 있는지 확인');
      console.log('2. SLACK_NOTICE_CHANNEL_ID가 설정되어 있는지 확인');
      console.log('3. SLACK_NOTICE_USER_IDS가 설정되어 있는지 확인');
      console.log('4. 슬랙 워커가 실행 중인지 확인');
      console.log('5. 슬랙 채널에 메시지가 있는지 확인');
    } else {
      console.log('최근 공지사항 목록:');
      notices.forEach((notice, index) => {
        console.log(`\n[${index + 1}] ID: ${notice.id}`);
        console.log(`   게임명: ${notice.gameName}`);
        console.log(`   작성자: ${notice.managerName}`);
        console.log(`   카테고리: ${notice.category}`);
        console.log(`   내용: ${notice.content?.substring(0, 50)}${notice.content?.length > 50 ? '...' : ''}`);
        console.log(`   이미지: ${notice.screenshotPath ? '✅ 있음' : '❌ 없음'}`);
        console.log(`   생성일: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
        console.log(`   생성자: ${notice.createdBy || 'N/A'}`);
      });
    }

    // 슬랙 워커로 생성된 공지사항 통계
    const slackNotices = await prisma.customerFeedbackNotice.count({
      where: {
        createdBy: 'slack_worker'
      }
    });

    console.log(`\n=== 통계 ===`);
    console.log(`슬랙 워커로 생성된 공지: ${slackNotices}개`);

    // 이미지가 있는 공지사항 수
    const noticesWithImage = await prisma.customerFeedbackNotice.count({
      where: {
        screenshotPath: { not: null }
      }
    });

    console.log(`이미지가 있는 공지: ${noticesWithImage}개`);

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkNotices();









