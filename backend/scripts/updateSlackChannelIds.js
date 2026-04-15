/**
 * 기존 슬랙 공지사항에 채널 ID 업데이트 스크립트
 * createdBy가 'slack_worker'인 공지사항에 SLACK_NOTICE_CHANNEL_ID를 설정
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function updateSlackChannelIds() {
  try {
    const SLACK_NOTICE_CHANNEL_ID = process.env.SLACK_NOTICE_CHANNEL_ID;
    
    if (!SLACK_NOTICE_CHANNEL_ID) {
      console.error('❌ SLACK_NOTICE_CHANNEL_ID 환경 변수가 설정되지 않았습니다.');
      process.exit(1);
    }

    console.log('=== 슬랙 채널 ID 업데이트 시작 ===\n');
    console.log(`채널 ID: ${SLACK_NOTICE_CHANNEL_ID}\n`);

    // slackChannelId가 null이고 createdBy가 'slack_worker'인 공지사항 찾기
    const noticesToUpdate = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker',
        slackChannelId: null
      },
      select: {
        id: true,
        gameName: true,
        managerName: true,
        createdAt: true
      }
    });

    console.log(`업데이트 대상 공지사항: ${noticesToUpdate.length}개\n`);

    if (noticesToUpdate.length === 0) {
      console.log('✅ 업데이트할 공지사항이 없습니다.');
      await prisma.$disconnect();
      return;
    }

    // 업데이트 실행
    const result = await prisma.customerFeedbackNotice.updateMany({
      where: {
        createdBy: 'slack_worker',
        slackChannelId: null
      },
      data: {
        slackChannelId: SLACK_NOTICE_CHANNEL_ID
      }
    });

    console.log(`✅ ${result.count}개의 공지사항이 업데이트되었습니다.\n`);

    // 업데이트된 공지사항 목록 표시
    console.log('업데이트된 공지사항 목록:');
    noticesToUpdate.forEach((notice, index) => {
      console.log(`  [${index + 1}] ID: ${notice.id}`);
      console.log(`      게임명: ${notice.gameName}`);
      console.log(`      작성자: ${notice.managerName}`);
      console.log(`      생성일: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
      console.log('');
    });

    console.log('=== 업데이트 완료 ===');

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

updateSlackChannelIds();









