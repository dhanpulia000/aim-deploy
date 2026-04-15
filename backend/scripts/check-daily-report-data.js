// 일일 보고서 데이터 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDailyReportData() {
  try {
    const startDate = '2025-12-07';
    const endDate = '2025-12-08';
    const projectId = 2; // 테스트용 프로젝트 ID

    console.log(`일일 보고서 데이터 확인 (${startDate} ~ ${endDate})\n`);
    console.log(`프로젝트 ID: ${projectId}\n`);

    // 1. 프로젝트 필터 없이 전체 데이터 확인
    console.log('='.repeat(80));
    console.log('1. 전체 프로젝트 데이터 (프로젝트 필터 없음):');
    console.log('='.repeat(80));
    const allIssues = await prisma.reportItemIssue.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        },
        excludedFromReport: false
      },
      select: {
        id: true,
        date: true,
        summary: true,
        projectId: true,
        createdAt: true,
        categoryGroup: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        date: 'asc'
      },
      take: 20
    });

    console.log(`총 ${allIssues.length}개의 이슈 발견 (최대 20개 표시)\n`);
    allIssues.forEach((issue, idx) => {
      console.log(`${idx + 1}. ID: ${issue.id}`);
      console.log(`   날짜: ${issue.date}`);
      console.log(`   프로젝트 ID: ${issue.projectId || 'null'}`);
      console.log(`   카테고리: ${issue.categoryGroup?.name || '없음'}`);
      console.log(`   제목: ${issue.summary?.substring(0, 50) || '제목 없음'}`);
      console.log(`   생성일시: ${issue.createdAt}`);
      console.log('');
    });

    // 2. 프로젝트 필터 적용
    console.log('='.repeat(80));
    console.log(`2. 프로젝트 ID=${projectId} 필터 적용:`);
    console.log('='.repeat(80));
    const projectIssues = await prisma.reportItemIssue.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        },
        excludedFromReport: false,
        projectId: projectId
      },
      select: {
        id: true,
        date: true,
        summary: true,
        projectId: true,
        createdAt: true
      },
      orderBy: {
        date: 'asc'
      }
    });

    console.log(`프로젝트 ID=${projectId}인 이슈: ${projectIssues.length}개\n`);
    if (projectIssues.length > 0) {
      projectIssues.slice(0, 10).forEach((issue, idx) => {
        console.log(`${idx + 1}. 날짜: ${issue.date}, 제목: ${issue.summary?.substring(0, 50) || '제목 없음'}`);
      });
    } else {
      console.log('⚠️  프로젝트 필터 적용 시 데이터가 없습니다.\n');
    }

    // 3. projectId가 null인 이슈 확인
    console.log('='.repeat(80));
    console.log('3. projectId가 null인 이슈 (크롤링 이슈):');
    console.log('='.repeat(80));
    const nullProjectIssues = await prisma.reportItemIssue.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        },
        excludedFromReport: false,
        projectId: null
      },
      select: {
        id: true,
        date: true,
        summary: true,
        projectId: true,
        createdAt: true
      },
      orderBy: {
        date: 'asc'
      },
      take: 10
    });

    console.log(`projectId가 null인 이슈: ${nullProjectIssues.length}개 (최대 10개 표시)\n`);
    nullProjectIssues.forEach((issue, idx) => {
      console.log(`${idx + 1}. 날짜: ${issue.date}, 제목: ${issue.summary?.substring(0, 50) || '제목 없음'}`);
    });

    // 4. 날짜별 통계
    console.log('\n' + '='.repeat(80));
    console.log('4. 날짜별 통계:');
    console.log('='.repeat(80));
    const dateStats = await prisma.reportItemIssue.groupBy({
      by: ['date'],
      where: {
        date: {
          gte: startDate,
          lte: endDate
        },
        excludedFromReport: false
      },
      _count: {
        id: true
      }
    });

    dateStats.forEach(stat => {
      console.log(`${stat.date}: ${stat._count.id}개 이슈`);
    });

    // 5. 프로젝트별 통계
    console.log('\n' + '='.repeat(80));
    console.log('5. 프로젝트별 통계:');
    console.log('='.repeat(80));
    const projectStats = await prisma.reportItemIssue.groupBy({
      by: ['projectId'],
      where: {
        date: {
          gte: startDate,
          lte: endDate
        },
        excludedFromReport: false
      },
      _count: {
        id: true
      }
    });

    projectStats.forEach(stat => {
      console.log(`프로젝트 ID: ${stat.projectId || 'null'}: ${stat._count.id}개 이슈`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('분석 완료');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDailyReportData();







