// 모니터링 게시판 및 URL에 게임 타입에 맞는 프로젝트 ID 설정 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setCorrectProjectToBoards() {
  try {
    console.log('모니터링 게시판 및 URL에 게임 타입별 프로젝트 ID 설정\n');

    // 프로젝트 매핑
    const projectMapping = {
      'PUBG_PC': 2,      // PUBG PC
      'PUBG_MOBILE': 3   // PUBG Mobile
    };

    console.log('프로젝트 매핑:');
    console.log('PUBG_PC → 프로젝트 ID 2');
    console.log('PUBG_MOBILE → 프로젝트 ID 3\n');

    // 1. MonitoredBoard 업데이트
    console.log('='.repeat(80));
    console.log('MonitoredBoard 업데이트:');
    console.log('='.repeat(80));
    const boards = await prisma.monitoredBoard.findMany();

    for (const board of boards) {
      const projectId = projectMapping[board.cafeGame];
      if (projectId && board.projectId !== projectId) {
        await prisma.monitoredBoard.update({
          where: { id: board.id },
          data: { projectId: projectId }
        });
        console.log(`✅ 게시판 ID ${board.id} (${board.name}, ${board.cafeGame}) → 프로젝트 ID ${projectId} 설정`);
      } else if (!projectId) {
        console.log(`⚠️  게시판 ID ${board.id} (${board.name}): 알 수 없는 게임 타입 '${board.cafeGame}'`);
      } else {
        console.log(`✓ 게시판 ID ${board.id} (${board.name}): 이미 올바른 프로젝트 ID (${board.projectId})`);
      }
    }

    // 2. MonitoredUrl 업데이트
    console.log('\n' + '='.repeat(80));
    console.log('MonitoredUrl 업데이트:');
    console.log('='.repeat(80));
    const urls = await prisma.monitoredUrl.findMany();

    for (const url of urls) {
      const projectId = projectMapping[url.cafeGame];
      if (projectId && url.projectId !== projectId) {
        await prisma.monitoredUrl.update({
          where: { id: url.id },
          data: { projectId: projectId }
        });
        console.log(`✅ URL ID ${url.id} (${url.cafeGame}) → 프로젝트 ID ${projectId} 설정`);
      } else if (!projectId) {
        console.log(`⚠️  URL ID ${url.id}: 알 수 없는 게임 타입 '${url.cafeGame}'`);
      } else {
        console.log(`✓ URL ID ${url.id}: 이미 올바른 프로젝트 ID (${url.projectId})`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('완료!');
    console.log('='.repeat(80));
    console.log('\n이제 기존 크롤링된 이슈들도 게시판/URL의 프로젝트 ID에 맞게 업데이트해야 합니다.');
    console.log('update-issue-project-ids.js 스크립트를 실행하세요.\n');

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setCorrectProjectToBoards();







