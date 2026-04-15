// 기존 크롤링 이슈의 projectId 업데이트 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateIssueProjectIds() {
  try {
    console.log('기존 크롤링 이슈의 projectId 업데이트\n');

    // 1. monitoredBoardId나 monitoredUrlId가 있는데 projectId가 null인 이슈 찾기
    const issuesToUpdate = await prisma.reportItemIssue.findMany({
      where: {
        projectId: null,
        OR: [
          { monitoredBoardId: { not: null } },
          { monitoredUrlId: { not: null } }
        ]
      },
      select: {
        id: true,
        monitoredBoardId: true,
        monitoredUrlId: true,
        summary: true
      },
      // take 제한 제거 - 모든 이슈 처리
    });

    console.log(`projectId가 null인 크롤링 이슈: ${issuesToUpdate.length}개\n`);

    if (issuesToUpdate.length === 0) {
      console.log('업데이트할 이슈가 없습니다.');
      return;
    }

    // 2. 각 이슈의 projectId 업데이트
    let updatedCount = 0;
    let skippedCount = 0;

    for (const issue of issuesToUpdate) {
      let projectId = null;

      // monitoredBoard에서 projectId 가져오기
      if (issue.monitoredBoardId) {
        const board = await prisma.monitoredBoard.findUnique({
          where: { id: issue.monitoredBoardId },
          select: { projectId: true }
        });
        if (board && board.projectId) {
          projectId = board.projectId;
        }
      }

      // monitoredUrl에서 projectId 가져오기 (board에서 못 찾은 경우)
      if (!projectId && issue.monitoredUrlId) {
        const url = await prisma.monitoredUrl.findUnique({
          where: { id: issue.monitoredUrlId },
          select: { projectId: true }
        });
        if (url && url.projectId) {
          projectId = url.projectId;
        }
      }

      if (projectId) {
        await prisma.reportItemIssue.update({
          where: { id: issue.id },
          data: { projectId: projectId }
        });
        updatedCount++;
        if (updatedCount <= 10) {
          console.log(`✅ 이슈 ID ${issue.id} → 프로젝트 ID ${projectId} 설정`);
        }
      } else {
        skippedCount++;
        if (skippedCount <= 10) {
          console.log(`⚠️  이슈 ID ${issue.id} → projectId를 찾을 수 없음 (monitoredBoard/Url에 projectId가 없음)`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('완료!');
    console.log('='.repeat(80));
    console.log(`✅ 업데이트된 이슈: ${updatedCount}개`);
    if (skippedCount > 0) {
      console.log(`⚠️  건너뛴 이슈: ${skippedCount}개 (monitoredBoard/Url에 projectId가 없음)`);
    }
    console.log('');

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateIssueProjectIds();

