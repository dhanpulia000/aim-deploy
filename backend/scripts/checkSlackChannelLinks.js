/**
 * 슬랙 채널 링크 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function checkSlackChannelLinks() {
  try {
    console.log('=== 슬랙 채널 링크 확인 ===\n');

    // 최근 공지사항 조회
    const notices = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker'
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        gameName: true,
        managerName: true,
        slackChannelId: true,
        slackTeamId: true,
        createdAt: true
      }
    });

    console.log(`최근 공지사항: ${notices.length}개\n`);

    if (notices.length === 0) {
      console.log('⚠️  공지사항이 없습니다.');
      await prisma.$disconnect();
      return;
    }

    // 각 공지사항의 링크 정보 확인
    notices.forEach((notice, index) => {
      console.log(`[${index + 1}] ID: ${notice.id}`);
      console.log(`   게임명: ${notice.gameName}`);
      console.log(`   작성자: ${notice.managerName}`);
      console.log(`   생성일: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
      
      if (notice.slackChannelId) {
        const channelId = notice.slackChannelId.startsWith('C') 
          ? notice.slackChannelId 
          : `C${notice.slackChannelId}`;
        
        if (notice.slackTeamId) {
          // teamId가 있으면 정확한 링크
          const link = `https://app.slack.com/client/${notice.slackTeamId}/${channelId}`;
          console.log(`   채널 ID: ${channelId}`);
          console.log(`   팀 ID: ${notice.slackTeamId}`);
          console.log(`   링크: ${link}`);
          console.log(`   상태: ✅ 정확한 링크 (teamId 포함)`);
        } else {
          // teamId가 없으면 Deep Link
          const link = `slack://channel?id=${channelId}`;
          console.log(`   채널 ID: ${channelId}`);
          console.log(`   팀 ID: 없음`);
          console.log(`   링크: ${link}`);
          console.log(`   상태: ⚠️  Deep Link (teamId 없음, 앱에서만 작동)`);
        }
      } else {
        console.log(`   채널 ID: 없음`);
        console.log(`   상태: ❌ 채널 링크 없음`);
      }
      console.log('');
    });

    // 통계
    const withTeamId = notices.filter(n => n.slackTeamId).length;
    const withoutTeamId = notices.filter(n => n.slackChannelId && !n.slackTeamId).length;
    const withoutChannelId = notices.filter(n => !n.slackChannelId).length;

    console.log(`=== 통계 ===`);
    console.log(`총 공지사항: ${notices.length}개`);
    console.log(`teamId 있음: ${withTeamId}개 (정확한 링크)`);
    console.log(`teamId 없음: ${withoutTeamId}개 (Deep Link)`);
    console.log(`채널 ID 없음: ${withoutChannelId}개`);

    // 환경 변수 확인
    console.log(`\n=== 환경 변수 확인 ===`);
    console.log(`SLACK_NOTICE_CHANNEL_ID: ${process.env.SLACK_NOTICE_CHANNEL_ID || '미설정'}`);
    console.log(`SLACK_BOT_TOKEN: ${process.env.SLACK_BOT_TOKEN ? '설정됨' : '미설정'}`);

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkSlackChannelLinks();









