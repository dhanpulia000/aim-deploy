/**
 * 슬랙 공지 수집 상태 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function checkSlackNotices() {
  try {
    console.log('=== 슬랙 공지 수집 상태 확인 ===\n');

    // 최근 24시간 내 수집된 슬랙 공지 확인
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    const recentNotices = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker',
        createdAt: {
          gte: yesterday
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    console.log(`최근 24시간 내 수집된 공지: ${recentNotices.length}개\n`);

    if (recentNotices.length === 0) {
      console.log('⚠️  최근 24시간 내 수집된 공지가 없습니다.\n');
      
      // 전체 슬랙 공지 개수 확인
      const totalCount = await prisma.customerFeedbackNotice.count({
        where: {
          createdBy: 'slack_worker'
        }
      });
      
      console.log(`전체 슬랙 공지 개수: ${totalCount}개\n`);
      
      // 가장 최근 공지 확인
      const latestNotice = await prisma.customerFeedbackNotice.findFirst({
        where: {
          createdBy: 'slack_worker'
        },
        orderBy: { createdAt: 'desc' }
      });
      
      if (latestNotice) {
        console.log('가장 최근 수집된 공지:');
        console.log(`  ID: ${latestNotice.id}`);
        console.log(`  게임명: ${latestNotice.gameName}`);
        console.log(`  작성자: ${latestNotice.managerName}`);
        console.log(`  카테고리: ${latestNotice.category}`);
        console.log(`  내용: ${latestNotice.content?.substring(0, 100)}${latestNotice.content?.length > 100 ? '...' : ''}`);
        console.log(`  생성 시간: ${new Date(latestNotice.createdAt).toLocaleString('ko-KR')}`);
        console.log(`  이미지: ${latestNotice.screenshotPath ? '✅ 있음' : '❌ 없음'}`);
      }
    } else {
      console.log('최근 수집된 공지 목록:');
      recentNotices.forEach((notice, index) => {
        console.log(`\n[${index + 1}] ID: ${notice.id}`);
        console.log(`    게임명: ${notice.gameName}`);
        console.log(`    작성자: ${notice.managerName}`);
        console.log(`    카테고리: ${notice.category}`);
        console.log(`    내용: ${notice.content?.substring(0, 80)}${notice.content?.length > 80 ? '...' : ''}`);
        console.log(`    생성 시간: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
        console.log(`    이미지: ${notice.screenshotPath ? '✅ 있음' : '❌ 없음'}`);
      });
    }

    // 워커 설정 확인
    console.log('\n=== 워커 설정 확인 ===');
    const hasToken = !!process.env.SLACK_BOT_TOKEN;
    const hasChannelId = !!process.env.SLACK_NOTICE_CHANNEL_ID;
    
    console.log(`SLACK_BOT_TOKEN: ${hasToken ? '✅ 설정됨' : '❌ 설정 안 됨'}`);
    console.log(`SLACK_NOTICE_CHANNEL_ID: ${hasChannelId ? '✅ 설정됨' : '❌ 설정 안 됨'}`);
    
    if (hasToken && hasChannelId) {
      console.log(`채널 ID: ${process.env.SLACK_NOTICE_CHANNEL_ID}`);
    } else {
      console.log('\n⚠️  워커 설정이 완료되지 않았습니다.');
      console.log('   .env 파일에 SLACK_BOT_TOKEN과 SLACK_NOTICE_CHANNEL_ID를 설정해주세요.');
    }

    // 수동 트리거 플래그 확인
    const triggerConfig = await prisma.monitoringConfig.findUnique({
      where: { key: 'manual_slack_notice_trigger' }
    });
    
    if (triggerConfig) {
      const triggerTime = parseInt(triggerConfig.value, 10);
      const now = Date.now();
      const timeDiff = now - triggerTime;
      
      console.log('\n=== 수동 트리거 상태 ===');
      if (timeDiff < 60000) {
        console.log(`✅ 최근 1분 이내에 트리거됨 (${Math.floor(timeDiff / 1000)}초 전)`);
      } else {
        console.log(`⚠️  트리거 플래그가 있지만 1분 이상 지났습니다 (${Math.floor(timeDiff / 60000)}분 전)`);
      }
    }

    console.log('\n=== 확인 완료 ===');

  } catch (error) {
    console.error('오류 발생:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkSlackNotices();









