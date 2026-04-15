const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // 제목에 "6년 전통의 AGT클랜 신입회원 모집중"이 포함된 이슈 찾기
    const issue = await prisma.reportItemIssue.findFirst({
      where: {
        summary: {
          contains: '6년 전통의 AGT클랜 신입회원 모집중'
        }
      },
      include: {
        monitoredBoard: true
      }
    });

    if (issue) {
      console.log('=== 이슈 정보 ===');
      console.log('ID:', issue.id);
      console.log('제목:', issue.summary);
      console.log('requiresLogin:', issue.requiresLogin);
      console.log('본문 길이:', issue.detail?.length || 0);
      console.log('본문 미리보기:', issue.detail?.substring(0, 200) || '(없음)');
      console.log('sourceUrl:', issue.sourceUrl);
      console.log('externalPostId:', issue.externalPostId);
      console.log('생성일:', issue.createdAt);
      console.log('모니터링 보드:', issue.monitoredBoard?.name || '(없음)');
    } else {
      console.log('해당 제목의 이슈를 찾을 수 없습니다.');
      
      // 비슷한 제목 검색
      const similarIssues = await prisma.reportItemIssue.findMany({
        where: {
          OR: [
            { summary: { contains: 'AGT클랜' } },
            { summary: { contains: '신입회원' } },
            { summary: { contains: '모집' } }
          ]
        },
        select: {
          id: true,
          summary: true,
          requiresLogin: true,
          sourceUrl: true
        },
        take: 5
      });
      
      if (similarIssues.length > 0) {
        console.log('\n=== 비슷한 이슈들 ===');
        similarIssues.forEach(i => {
          console.log(`- ${i.summary} (requiresLogin: ${i.requiresLogin})`);
        });
      }
    }
  } catch (err) {
    console.error('오류 발생:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();









