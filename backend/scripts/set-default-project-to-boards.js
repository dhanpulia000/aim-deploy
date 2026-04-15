// 모니터링 게시판 및 URL에 기본 프로젝트 ID 설정 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setDefaultProjectToBoards() {
  try {
    console.log('모니터링 게시판 및 URL에 프로젝트 ID 설정\n');

    // 1. 프로젝트 목록 확인
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'asc' }
    });

    if (projects.length === 0) {
      console.log('❌ 프로젝트가 없습니다. 먼저 프로젝트를 생성해주세요.');
      return;
    }

    console.log('='.repeat(80));
    console.log('프로젝트 목록:');
    console.log('='.repeat(80));
    projects.forEach((project, idx) => {
      console.log(`${idx + 1}. ID: ${project.id}, 이름: ${project.name}`);
    });
    console.log('');

    // 기본 프로젝트 ID는 첫 번째 프로젝트 사용
    const defaultProjectId = projects[0].id;
    console.log(`기본 프로젝트 ID: ${defaultProjectId} (${projects[0].name})\n`);

    // 2. MonitoredBoard 확인 및 업데이트
    console.log('='.repeat(80));
    console.log('MonitoredBoard 업데이트:');
    console.log('='.repeat(80));
    const boards = await prisma.monitoredBoard.findMany({
      where: {
        projectId: null
      }
    });

    console.log(`projectId가 null인 게시판: ${boards.length}개\n`);

    if (boards.length > 0) {
      for (const board of boards) {
        await prisma.monitoredBoard.update({
          where: { id: board.id },
          data: { projectId: defaultProjectId }
        });
        console.log(`✅ 게시판 ID ${board.id} (${board.name}) → 프로젝트 ID ${defaultProjectId} 설정`);
      }
    } else {
      console.log('업데이트할 게시판이 없습니다.');
    }

    // 3. MonitoredUrl 확인 및 업데이트
    console.log('\n' + '='.repeat(80));
    console.log('MonitoredUrl 업데이트:');
    console.log('='.repeat(80));
    const urls = await prisma.monitoredUrl.findMany({
      where: {
        projectId: null
      }
    });

    console.log(`projectId가 null인 URL: ${urls.length}개\n`);

    if (urls.length > 0) {
      for (const url of urls) {
        await prisma.monitoredUrl.update({
          where: { id: url.id },
          data: { projectId: defaultProjectId }
        });
        console.log(`✅ URL ID ${url.id} (${url.url.substring(0, 50)}...) → 프로젝트 ID ${defaultProjectId} 설정`);
      }
    } else {
      console.log('업데이트할 URL이 없습니다.');
    }

    console.log('\n' + '='.repeat(80));
    console.log('완료!');
    console.log('='.repeat(80));
    console.log('\n참고: 이후에 크롤링되는 새로운 이슈는 프로젝트 ID가 자동으로 설정됩니다.');
    console.log('기존 이슈의 projectId를 업데이트하려면 별도 마이그레이션이 필요합니다.\n');

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setDefaultProjectToBoards();







