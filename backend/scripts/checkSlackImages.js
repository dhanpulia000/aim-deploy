/**
 * 슬랙 이미지 수집 상태 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');
const fs = require('fs').promises;
const path = require('path');

async function checkSlackImages() {
  try {
    console.log('=== 슬랙 이미지 수집 상태 확인 ===\n');

    // 이미지가 있는 공지사항 조회
    const noticesWithImage = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker',
        screenshotPath: { not: null }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        gameName: true,
        managerName: true,
        content: true,
        screenshotPath: true,
        createdAt: true
      }
    });

    console.log(`1. 이미지가 있는 공지사항: ${noticesWithImage.length}개\n`);

    if (noticesWithImage.length === 0) {
      console.log('⚠️  이미지가 있는 공지사항이 없습니다.\n');
      
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

      console.log('2. 최근 공지사항 (이미지 경로 확인):');
      recentNotices.forEach((notice, index) => {
        console.log(`\n   [${index + 1}] ID: ${notice.id}`);
        console.log(`       게임명: ${notice.gameName}`);
        console.log(`       작성자: ${notice.managerName}`);
        console.log(`       내용: ${notice.content?.substring(0, 50)}${notice.content?.length > 50 ? '...' : ''}`);
        console.log(`       이미지 경로: ${notice.screenshotPath || '❌ 없음'}`);
        console.log(`       생성 시간: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
      });
    } else {
      console.log('2. 이미지가 있는 공지사항 상세:');
      
      for (const notice of noticesWithImage) {
        console.log(`\n   ID: ${notice.id}`);
        console.log(`   게임명: ${notice.gameName}`);
        console.log(`   작성자: ${notice.managerName}`);
        console.log(`   내용: ${notice.content?.substring(0, 50)}${notice.content?.length > 50 ? '...' : ''}`);
        console.log(`   이미지 경로: ${notice.screenshotPath}`);
        console.log(`   생성 시간: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);

        // 실제 파일 존재 확인
        if (notice.screenshotPath) {
          const fullPath = path.join(__dirname, '..', 'uploads', notice.screenshotPath);
          try {
            const stats = await fs.stat(fullPath);
            const fileSizeKB = (stats.size / 1024).toFixed(2);
            console.log(`   파일 상태: ✅ 존재함 (크기: ${fileSizeKB} KB)`);
            
            // 파일 확장자 확인
            const ext = path.extname(fullPath).toLowerCase();
            console.log(`   파일 형식: ${ext || '확장자 없음'}`);
          } catch (fileError) {
            console.log(`   파일 상태: ❌ 파일이 존재하지 않음`);
            console.log(`   예상 경로: ${fullPath}`);
          }
        }
      }
    }

    // 통계
    const totalNotices = await prisma.customerFeedbackNotice.count({
      where: {
        createdBy: 'slack_worker'
      }
    });

    const noticesWithoutImage = totalNotices - noticesWithImage.length;

    console.log(`\n3. 통계:`);
    console.log(`   총 공지사항: ${totalNotices}개`);
    console.log(`   이미지 있음: ${noticesWithImage.length}개`);
    console.log(`   이미지 없음: ${noticesWithoutImage}개`);

    // 오늘 생성된 공지 중 이미지가 있는 것
    const todayNoticesWithImage = await prisma.customerFeedbackNotice.count({
      where: {
        createdBy: 'slack_worker',
        screenshotPath: { not: null },
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    });

    console.log(`   오늘 생성된 공지 중 이미지 있음: ${todayNoticesWithImage}개\n`);

    // 이미지 다운로드 디렉토리 확인
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'screenshots');
    try {
      await fs.stat(uploadsDir);
      console.log('4. 이미지 저장 디렉토리:');
      console.log(`   경로: ${uploadsDir}`);
      console.log(`   상태: ✅ 존재함`);
      
      // 하위 디렉토리 확인
      const subdirs = await fs.readdir(uploadsDir);
      console.log(`   하위 디렉토리: ${subdirs.length}개`);
      if (subdirs.length > 0) {
        console.log(`   디렉토리 목록: ${subdirs.slice(0, 5).join(', ')}${subdirs.length > 5 ? '...' : ''}`);
      }
    } catch (dirError) {
      console.log('4. 이미지 저장 디렉토리:');
      console.log(`   경로: ${uploadsDir}`);
      console.log(`   상태: ❌ 존재하지 않음`);
    }

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkSlackImages();

