/**
 * 슬랙 이미지 상세 확인 스크립트
 * 최근 공지사항의 메시지 타임스탬프와 이미지 파일명 매칭 확인
 */

require('dotenv').config();
const { prisma } = require('../libs/db');
const fs = require('fs').promises;
const path = require('path');

async function checkSlackImageDetails() {
  try {
    console.log('=== 슬랙 이미지 상세 확인 ===\n');

    // 최근 공지사항 조회 (slackMessageTs 포함)
    const recentNotices = await prisma.customerFeedbackNotice.findMany({
      where: {
        createdBy: 'slack_worker'
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        gameName: true,
        managerName: true,
        content: true,
        screenshotPath: true,
        createdAt: true
      }
    });

    console.log(`최근 공지사항: ${recentNotices.length}개\n`);

    // 오늘 생성된 이미지 파일 목록
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'screenshots', '2025-12-02');
    let imageFiles = [];
    try {
      const files = await fs.readdir(uploadsDir);
      imageFiles = files.filter(f => f.startsWith('issue_') && (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')));
    } catch (error) {
      console.log(`⚠️  디렉토리 읽기 실패: ${uploadsDir}`);
    }

    console.log(`오늘 생성된 이미지 파일: ${imageFiles.length}개\n`);

    // 각 공지사항 확인
    for (const notice of recentNotices) {
      console.log(`[ID: ${notice.id}] ${notice.gameName} - ${notice.managerName}`);
      console.log(`   내용: ${notice.content?.substring(0, 60)}${notice.content?.length > 60 ? '...' : ''}`);
      console.log(`   생성 시간: ${new Date(notice.createdAt).toLocaleString('ko-KR')}`);
      
      if (notice.screenshotPath) {
        console.log(`   이미지 경로: ✅ ${notice.screenshotPath}`);
        
        // 실제 파일 확인
        const fullPath = path.join(__dirname, '..', 'uploads', notice.screenshotPath);
        try {
          const stats = await fs.stat(fullPath);
          const fileSizeKB = (stats.size / 1024).toFixed(2);
          console.log(`   파일 상태: ✅ 존재함 (${fileSizeKB} KB)`);
        } catch (fileError) {
          console.log(`   파일 상태: ❌ 파일이 존재하지 않음`);
          console.log(`   예상 경로: ${fullPath}`);
        }
      } else {
        console.log(`   이미지 경로: ❌ 없음`);
        
        // 생성 시간 기준으로 비슷한 시간대의 이미지 파일 찾기
        const noticeTime = new Date(notice.createdAt).getTime();
        const similarFiles = imageFiles.filter(file => {
          const filePath = path.join(uploadsDir, file);
          try {
            const stats = fs.statSync(filePath);
            const fileTime = stats.mtime.getTime();
            const timeDiff = Math.abs(fileTime - noticeTime);
            return timeDiff < 5 * 60 * 1000; // 5분 이내
          } catch {
            return false;
          }
        });
        
        if (similarFiles.length > 0) {
          console.log(`   ⚠️  비슷한 시간대의 이미지 파일 발견: ${similarFiles.slice(0, 3).join(', ')}`);
        }
      }
      console.log('');
    }

    // 통계
    const noticesWithImage = recentNotices.filter(n => n.screenshotPath).length;
    const noticesWithoutImage = recentNotices.length - noticesWithImage;

    console.log(`\n=== 요약 ===`);
    console.log(`최근 공지사항: ${recentNotices.length}개`);
    console.log(`이미지 있음: ${noticesWithImage}개`);
    console.log(`이미지 없음: ${noticesWithoutImage}개`);
    console.log(`오늘 생성된 이미지 파일: ${imageFiles.length}개`);

    // 이미지 다운로드 실패 가능성 분석
    if (noticesWithoutImage > 0) {
      console.log(`\n⚠️  이미지가 없는 공지사항이 ${noticesWithoutImage}개 있습니다.`);
      console.log(`   가능한 원인:`);
      console.log(`   1. 슬랙 메시지에 실제로 이미지가 없었음`);
      console.log(`   2. 이미지 다운로드 실패 (인증 문제, 네트워크 문제 등)`);
      console.log(`   3. 이미지 파일 형식이 지원되지 않음`);
      console.log(`   확인: 백엔드 서버 로그에서 [SlackNoticeWorker] 메시지를 확인하세요.`);
    }

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkSlackImageDetails();









