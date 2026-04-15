/**
 * 공지사항 이미지 상태 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');
const fs = require('fs').promises;
const path = require('path');

async function checkNoticeImage() {
  try {
    console.log('=== 공지사항 이미지 상태 확인 ===\n');

    // 최근 공지사항 조회
    const notice = await prisma.customerFeedbackNotice.findFirst({
      where: {
        gameName: '슬랙테스트채널',
        managerName: '고영'
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        screenshotPath: true,
        createdAt: true,
        content: true,
        gameName: true,
        managerName: true
      }
    });

    if (!notice) {
      console.log('❌ 공지사항을 찾을 수 없습니다.');
      await prisma.$disconnect();
      return;
    }

    console.log('공지사항 정보:');
    console.log(`  ID: ${notice.id}`);
    console.log(`  게임명: ${notice.gameName}`);
    console.log(`  작성자: ${notice.managerName}`);
    console.log(`  생성일: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
    console.log(`  screenshotPath: ${notice.screenshotPath || 'null'}`);
    console.log('');

    if (!notice.screenshotPath) {
      console.log('⚠️  DB에 screenshotPath가 저장되지 않았습니다.');
      console.log('\n확인 사항:');
      console.log('1. 슬랙 메시지에 이미지가 포함되어 있었는지 확인');
      console.log('2. 서버 로그에서 이미지 다운로드 관련 메시지 확인');
      console.log('3. [SlackNoticeWorker] Image file found 메시지 확인');
      console.log('4. [SlackNoticeWorker] Image downloaded successfully 메시지 확인');
    } else {
      console.log('✅ DB에 screenshotPath가 저장되어 있습니다.');
      console.log(`  경로: ${notice.screenshotPath}`);
      
      // 실제 파일 존재 확인
      const fullPath = path.join(__dirname, '..', 'uploads', notice.screenshotPath);
      console.log(`  전체 경로: ${fullPath}`);
      
      try {
        await fs.access(fullPath);
        const stats = await fs.stat(fullPath);
        console.log('✅ 이미지 파일이 존재합니다.');
        console.log(`  파일 크기: ${(stats.size / 1024).toFixed(2)} KB`);
        console.log(`  수정일: ${stats.mtime.toLocaleString('ko-KR')}`);
      } catch (fileError) {
        console.log('❌ 이미지 파일이 존재하지 않습니다.');
        console.log(`  에러: ${fileError.message}`);
        console.log('\n가능한 원인:');
        console.log('1. 이미지 다운로드가 실패했지만 DB에는 경로가 저장됨');
        console.log('2. 파일이 다른 위치에 저장됨');
        console.log('3. 파일이 삭제됨');
      }
    }

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkNoticeImage();









