// 모니터링 게시판의 projectId 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMonitoredBoards() {
  try {
    console.log('모니터링 게시판 및 URL의 projectId 확인\n');

    // 1. MonitoredBoard 확인
    console.log('='.repeat(80));
    console.log('1. MonitoredBoard 목록:');
    console.log('='.repeat(80));
    const boards = await prisma.monitoredBoard.findMany({
      select: {
        id: true,
        name: true,
        cafeGame: true,
        projectId: true,
        enabled: true
      },
      orderBy: {
        id: 'asc'
      }
    });

    console.log(`총 ${boards.length}개의 게시판\n`);
    boards.forEach((board, idx) => {
      console.log(`${idx + 1}. ID: ${board.id}`);
      console.log(`   이름: ${board.name}`);
      console.log(`   게임: ${board.cafeGame}`);
      console.log(`   프로젝트 ID: ${board.projectId || 'null (⚠️ 문제!)'}`);
      console.log(`   활성화: ${board.enabled}`);
      console.log('');
    });

    // 2. MonitoredUrl 확인
    console.log('='.repeat(80));
    console.log('2. MonitoredUrl 목록:');
    console.log('='.repeat(80));
    const urls = await prisma.monitoredUrl.findMany({
      select: {
        id: true,
        url: true,
        cafeGame: true,
        projectId: true,
        enabled: true
      },
      orderBy: {
        id: 'asc'
      }
    });

    console.log(`총 ${urls.length}개의 URL\n`);
    urls.forEach((url, idx) => {
      console.log(`${idx + 1}. ID: ${url.id}`);
      console.log(`   URL: ${url.url.substring(0, 60)}...`);
      console.log(`   게임: ${url.cafeGame}`);
      console.log(`   프로젝트 ID: ${url.projectId || 'null (⚠️ 문제!)'}`);
      console.log(`   활성화: ${url.enabled}`);
      console.log('');
    });

    // 3. projectId가 null인 게시판/URL 개수
    const nullBoardCount = boards.filter(b => !b.projectId).length;
    const nullUrlCount = urls.filter(u => !u.projectId).length;

    console.log('='.repeat(80));
    console.log('3. 요약:');
    console.log('='.repeat(80));
    console.log(`MonitoredBoard 중 projectId가 null인 것: ${nullBoardCount}개`);
    console.log(`MonitoredUrl 중 projectId가 null인 것: ${nullUrlCount}개`);
    console.log('');

    if (nullBoardCount > 0 || nullUrlCount > 0) {
      console.log('⚠️  경고: projectId가 null인 게시판/URL이 있습니다!');
      console.log('이것이 크롤링된 이슈의 projectId가 null인 이유입니다.\n');
      console.log('해결 방법:');
      console.log('1. 관리자 페이지에서 모니터링 게시판/URL에 프로젝트를 지정하세요.');
      console.log('2. 또는 마이그레이션 스크립트로 기본 프로젝트 ID를 설정하세요.\n');
    }

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkMonitoredBoards();







