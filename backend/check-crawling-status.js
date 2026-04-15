const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCrawlingStatus() {
  try {
    console.log('\n=== 크롤링 동작 점검 ===\n');

    // 1. 활성화된 게시판 확인
    const boards = await prisma.monitoredBoard.findMany({
      where: { 
        isActive: true,
        enabled: true
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`[1] 활성화된 게시판: ${boards.length}개\n`);
    if (boards.length === 0) {
      console.log('  ⚠️  활성화된 게시판이 없습니다!\n');
    } else {
      for (const board of boards) {
        const lastScan = board.lastScanAt ? new Date(board.lastScanAt) : null;
        const now = new Date();
        const diffMin = lastScan ? Math.round((now - lastScan) / 1000 / 60) : null;
        const interval = board.checkInterval || board.interval || 300;
        const shouldScan = !lastScan || (diffMin && diffMin >= interval / 60);
        
        console.log(`  게시판 ID: ${board.id}`);
        console.log(`    이름: ${board.name || board.label || 'N/A'}`);
        console.log(`    URL: ${(board.url || board.listUrl || 'N/A').substring(0, 60)}...`);
        console.log(`    마지막 스캔: ${lastScan ? lastScan.toLocaleString('ko-KR') : '없음'}`);
        console.log(`    경과 시간: ${diffMin !== null ? `${diffMin}분 전` : 'N/A'}`);
        console.log(`    스캔 간격: ${interval}초 (${interval / 60}분)`);
        console.log(`    다음 스캔 예정: ${shouldScan ? '✅ 즉시 가능' : `⏳ 약 ${Math.ceil((interval / 60) - diffMin)}분 후`}`);
        console.log(`    마지막 Article ID: ${board.lastArticleId || '없음'}\n`);
      }
    }

    // 2. 최근 RawLog 확인 (최근 10개)
    const recentRawLogs = await prisma.rawLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        source: true,
        isProcessed: true,
        metadata: true
      }
    });

    console.log(`[2] 최근 RawLog 수집 내역 (최근 10개):`);
    if (recentRawLogs.length === 0) {
      console.log('  ⚠️  최근 수집된 RawLog가 없습니다.\n');
    } else {
      const naverLogs = recentRawLogs.filter(log => log.source === 'naver');
      const processedCount = recentRawLogs.filter(log => log.isProcessed).length;
      
      console.log(`  총 ${recentRawLogs.length}개 (네이버: ${naverLogs.length}개, 처리됨: ${processedCount}개)\n`);
      
      for (const log of recentRawLogs.slice(0, 5)) {
        const created = new Date(log.createdAt);
        const diffMin = Math.round((Date.now() - created.getTime()) / 1000 / 60);
        const meta = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
        
        console.log(`  - ID: ${log.id.substring(0, 20)}...`);
        console.log(`    생성: ${created.toLocaleString('ko-KR')} (${diffMin}분 전)`);
        console.log(`    소스: ${log.source}`);
        console.log(`    처리됨: ${log.isProcessed ? '✅' : '❌'}`);
        if (meta.title) {
          console.log(`    제목: ${meta.title.substring(0, 50)}...`);
        }
        if (meta.monitoredBoardId) {
          console.log(`    게시판 ID: ${meta.monitoredBoardId}`);
        }
        console.log('');
      }
    }

    // 3. 최근 이슈 확인 (최근 10개)
    const recentIssues = await prisma.reportItemIssue.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        detail: true,
        summary: true,
        externalSource: true,
        monitoredBoardId: true,
        sourceUrl: true
      }
    });

    console.log(`[3] 최근 생성된 이슈 (최근 10개):`);
    if (recentIssues.length === 0) {
      console.log('  ⚠️  최근 생성된 이슈가 없습니다.\n');
    } else {
      const naverIssues = recentIssues.filter(issue => issue.externalSource === 'naver');
      console.log(`  총 ${recentIssues.length}개 (네이버: ${naverIssues.length}개)\n`);
      
      for (const issue of recentIssues.slice(0, 5)) {
        const created = new Date(issue.createdAt);
        const diffMin = Math.round((Date.now() - created.getTime()) / 1000 / 60);
        
        console.log(`  - ID: ${issue.id}`);
        console.log(`    생성: ${created.toLocaleString('ko-KR')} (${diffMin}분 전)`);
        console.log(`    소스: ${issue.externalSource || 'N/A'}`);
        console.log(`    게시판 ID: ${issue.monitoredBoardId || 'N/A'}`);
        if (issue.summary) {
          console.log(`    요약: ${issue.summary.substring(0, 50)}...`);
        } else if (issue.detail) {
          console.log(`    내용: ${issue.detail.substring(0, 50)}...`);
        }
        console.log('');
      }
    }

    // 4. 워커 프로세스 상태 확인 (간접적)
    console.log(`[4] 워커 프로세스 상태:`);
    console.log(`  ⚠️  프로세스 상태는 서버 로그에서 확인하세요.`);
    console.log(`  백엔드 서버 콘솔에서 [NaverCafeWorker] 로그를 확인해주세요.\n`);

    // 5. 통계
    const totalRawLogs = await prisma.rawLog.count();
    const processedRawLogs = await prisma.rawLog.count({ where: { isProcessed: true } });
    const totalIssues = await prisma.reportItemIssue.count();
    const naverIssues = await prisma.reportItemIssue.count({ where: { externalSource: 'naver' } });

    console.log(`[5] 전체 통계:`);
    console.log(`  RawLog 총 개수: ${totalRawLogs}개 (처리됨: ${processedRawLogs}개, 미처리: ${totalRawLogs - processedRawLogs}개)`);
    console.log(`  이슈 총 개수: ${totalIssues}개 (네이버: ${naverIssues}개)\n`);

    // 6. 권장 사항
    console.log(`[6] 권장 사항:`);
    if (boards.length === 0) {
      console.log('  ⚠️  활성화된 게시판이 없습니다. Admin 페이지에서 게시판을 활성화하세요.');
    } else {
      const needsScan = boards.some(board => {
        if (!board.lastScanAt) return true;
        const diffSec = (Date.now() - new Date(board.lastScanAt).getTime()) / 1000;
        const interval = board.checkInterval || board.interval || 300;
        return diffSec >= interval;
      });
      
      if (needsScan) {
        console.log('  ✅ 일부 게시판이 스캔 가능 상태입니다.');
        console.log('     수동 스캔을 트리거하거나 워커가 자동으로 스캔할 때까지 기다리세요.');
      } else {
        console.log('  ⏳ 모든 게시판이 최근에 스캔되었습니다.');
        console.log('     다음 자동 스캔을 기다리거나 수동 스캔을 트리거하세요.');
      }
    }

    if (recentRawLogs.length === 0) {
      console.log('  ⚠️  최근 RawLog가 없습니다. 크롤링이 작동하지 않을 수 있습니다.');
      console.log('     백엔드 서버 로그에서 [NaverCafeWorker] 에러를 확인하세요.');
    }

    if (processedRawLogs < totalRawLogs * 0.9) {
      console.log('  ⚠️  많은 RawLog가 아직 처리되지 않았습니다.');
      console.log('     rawLogProcessor 워커가 정상 작동하는지 확인하세요.');
    }

    console.log('\n=== 점검 완료 ===\n');

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkCrawlingStatus();












