/**
 * 이미지 경로 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');
const fs = require('fs').promises;
const path = require('path');

async function checkImagePath() {
  try {
    console.log('=== 이미지 경로 확인 ===\n');

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
    console.log(`  DB 저장 경로: ${notice.screenshotPath || 'null'}`);
    console.log('');

    if (!notice.screenshotPath) {
      console.log('⚠️  DB에 screenshotPath가 저장되지 않았습니다.');
      await prisma.$disconnect();
      return;
    }

    // 경로 분석
    console.log('경로 분석:');
    console.log(`  DB 저장 경로: ${notice.screenshotPath}`);
    console.log(`  프론트엔드 요청 경로: /uploads/${notice.screenshotPath}`);
    console.log(`  예상 전체 파일 경로: backend/uploads/${notice.screenshotPath}`);
    console.log('');

    // 실제 파일 존재 확인
    const fullPath = path.join(__dirname, '..', 'uploads', notice.screenshotPath);
    console.log(`실제 파일 경로: ${fullPath}`);
    
    try {
      await fs.access(fullPath);
      const stats = await fs.stat(fullPath);
      console.log('✅ 이미지 파일이 존재합니다.');
      console.log(`  파일 크기: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`  수정일: ${stats.mtime.toLocaleString('ko-KR')}`);
    } catch (fileError) {
      console.log('❌ 이미지 파일이 존재하지 않습니다.');
      console.log(`  에러: ${fileError.message}`);
      
      // 디렉토리 구조 확인
      const dirPath = path.dirname(fullPath);
      console.log(`\n디렉토리 확인: ${dirPath}`);
      try {
        const files = await fs.readdir(dirPath);
        console.log(`  디렉토리 내 파일 수: ${files.length}`);
        console.log(`  파일 목록 (최대 10개):`);
        files.slice(0, 10).forEach(file => {
          console.log(`    - ${file}`);
        });
      } catch (dirError) {
        console.log(`  디렉토리 읽기 실패: ${dirError.message}`);
      }
    }

    // HTTP 요청 테스트
    console.log('\nHTTP 요청 테스트:');
    const axios = require('axios');
    try {
      const response = await axios.get(`http://127.0.0.1:8080/uploads/${notice.screenshotPath}`, {
        responseType: 'arraybuffer',
        validateStatus: () => true
      });
      console.log(`  상태 코드: ${response.status}`);
      if (response.status === 200) {
        console.log(`  ✅ HTTP 요청 성공 (크기: ${(response.data.length / 1024).toFixed(2)} KB)`);
      } else {
        console.log(`  ❌ HTTP 요청 실패`);
        console.log(`  응답: ${response.statusText}`);
      }
    } catch (httpError) {
      console.log(`  ❌ HTTP 요청 에러: ${httpError.message}`);
    }

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkImagePath();









