// 게시판/URL 기준으로 이슈의 프로젝트 ID 수정 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixIssueProjectIdsByBoard() {
  try {
    console.log('게시판/URL 기준으로 이슈의 프로젝트 ID 수정\n');

    // monitoredBoardId나 monitoredUrlId가 있는 모든 이슈 찾기
    const issues = await prisma.reportItemIssue.findMany({
      where: {
        OR: [
          { monitoredBoardId: { not: null } },
          { monitoredUrlId: { not: null } }
        ]
      },
      select: {
        id: true,
        monitoredBoardId: true,
        monitoredUrlId: true,
        projectId: true,
        summary: true
      }
    });

    console.log(`처리할 이슈: ${issues.length}개\n`);

    if (issues.length === 0) {
      console.log('처리할 이슈가 없습니다.');
      return;
    }

    let updatedCount = 0;
    let alreadyCorrectCount = 0;
    let skippedCount = 0;

    for (const issue of issues) {
      let correctProjectId = null;

      // monitoredBoard에서 올바른 projectId 가져오기
      if (issue.monitoredBoardId) {
        const board = await prisma.monitoredBoard.findUnique({
          where: { id: issue.monitoredBoardId },
          select: { projectId: true }
        });
        if (board && board.projectId) {
          correctProjectId = board.projectId;
        }
      }

      // monitoredUrl에서 올바른 projectId 가져오기 (board에서 못 찾은 경우)
      if (!correctProjectId && issue.monitoredUrlId) {
        const url = await prisma.monitoredUrl.findUnique({
          where: { id: issue.monitoredUrlId },
          select: { projectId: true }
        });
        if (url && url.projectId) {
          correctProjectId = url.projectId;
        }
      }

      if (correctProjectId) {
        if (issue.projectId !== correctProjectId) {
          await prisma.reportItemIssue.update({
            where: { id: issue.id },
            data: { projectId: correctProjectId }
          });
          updatedCount++;
          if (updatedCount <= 20) {
            console.log(`✅ 이슈 ID ${issue.id.substring(0, 20)}... → 프로젝트 ID ${issue.projectId || 'null'} → ${correctProjectId}`);
          }
        } else {
          alreadyCorrectCount++;
        }
      } else {
        skippedCount++;
        if (skippedCount <= 10) {
          console.log(`⚠️  이슈 ID ${issue.id.substring(0, 20)}... → 프로젝트 ID를 찾을 수 없음`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('완료!');
    console.log('='.repeat(80));
    console.log(`✅ 업데이트된 이슈: ${updatedCount}개`);
    console.log(`✓ 이미 올바른 프로젝트 ID: ${alreadyCorrectCount}개`);
    if (skippedCount > 0) {
      console.log(`⚠️  건너뛴 이슈: ${skippedCount}개`);
    }
    console.log('');

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixIssueProjectIdsByBoard();







