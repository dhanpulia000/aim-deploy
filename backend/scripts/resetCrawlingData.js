/**
 * 크롤링 데이터 리셋 스크립트
 * 
 * MonitoredBoard의 lastArticleId를 리셋하여 처음부터 다시 크롤링하도록 설정합니다.
 * RawLog의 isProcessed를 false로 리셋할 수도 있습니다.
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function resetCrawlingData() {
  try {
    console.log('크롤링 데이터 리셋 시작...');

    // 1. 모든 MonitoredBoard의 lastArticleId 리셋
    const boards = await prisma.monitoredBoard.findMany({
      where: { isActive: true }
    });

    console.log(`발견된 활성 게시판: ${boards.length}개`);

    for (const board of boards) {
      await prisma.monitoredBoard.update({
        where: { id: board.id },
        data: {
          lastArticleId: null,
          lastScanAt: null
        }
      });
      console.log(`게시판 리셋: ${board.name || board.label} (ID: ${board.id})`);
    }

    // 2. (선택사항) RawLog의 isProcessed를 false로 리셋
    const resetRawLogs = process.argv.includes('--reset-rawlogs');
    if (resetRawLogs) {
      const result = await prisma.rawLog.updateMany({
        where: { isProcessed: true },
        data: { isProcessed: false }
      });
      console.log(`RawLog 리셋: ${result.count}개 항목`);
    }

    // 3. (선택사항) 특정 소스의 이슈 삭제
    const deleteIssues = process.argv.includes('--delete-issues');
    if (deleteIssues) {
      const deleted = await prisma.reportItemIssue.deleteMany({
        where: {
          source: {
            startsWith: 'NAVER_CAFE'
          }
        }
      });
      console.log(`이슈 삭제: ${deleted.count}개 항목`);
    }

    console.log('크롤링 데이터 리셋 완료!');
    console.log('다음 크롤링 주기부터 처음부터 다시 수집됩니다.');

  } catch (error) {
    console.error('리셋 실패:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 실행
resetCrawlingData();












