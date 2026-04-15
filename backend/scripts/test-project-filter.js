// 프로젝트별 이슈 필터링 테스트 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testProjectFilter() {
  try {
    console.log('프로젝트별 이슈 필터링 테스트\n');
    console.log('='.repeat(80));

    // 1. 프로젝트 목록 조회
    console.log('\n1. 프로젝트 목록:');
    console.log('-'.repeat(80));
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        name: true
      },
      orderBy: { id: 'asc' }
    });

    projects.forEach(p => {
      console.log(`   ID: ${p.id}, 이름: ${p.name}`);
    });

    if (projects.length === 0) {
      console.log('   ⚠️  프로젝트가 없습니다.\n');
      return;
    }

    // 2. 전체 이슈 통계
    console.log('\n2. 전체 이슈 통계:');
    console.log('-'.repeat(80));
    const totalIssues = await prisma.reportItemIssue.count();
    const projectNullIssues = await prisma.reportItemIssue.count({
      where: { projectId: null }
    });
    const project2Issues = await prisma.reportItemIssue.count({
      where: { projectId: 2 }
    });
    const project3Issues = await prisma.reportItemIssue.count({
      where: { projectId: 3 }
    });

    console.log(`   전체 이슈: ${totalIssues}개`);
    console.log(`   projectId=null (크롤링 이슈): ${projectNullIssues}개`);
    console.log(`   projectId=2: ${project2Issues}개`);
    console.log(`   projectId=3: ${project3Issues}개`);

    // 3. 프로젝트별 필터링 테스트
    console.log('\n3. 프로젝트별 필터링 테스트:');
    console.log('-'.repeat(80));

    for (const project of projects) {
      console.log(`\n   프로젝트 ID: ${project.id} (${project.name})`);
      
      // 프로젝트 필터 적용 (OR 조건: projectId=project.id OR projectId=null)
      const filteredCount = await prisma.reportItemIssue.count({
        where: {
          OR: [
            { projectId: project.id },
            { projectId: null }
          ]
        }
      });

      const projectOnlyCount = await prisma.reportItemIssue.count({
        where: { projectId: project.id }
      });

      console.log(`      필터링 결과 (프로젝트 + null): ${filteredCount}개`);
      console.log(`      프로젝트만: ${projectOnlyCount}개`);
      console.log(`      null 포함: ${filteredCount - projectOnlyCount}개`);
    }

    // 4. 최근 이슈 샘플 확인
    console.log('\n4. 최근 이슈 샘플 (프로젝트별, 최근 5개):');
    console.log('-'.repeat(80));

    for (const project of projects) {
      console.log(`\n   프로젝트 ID: ${project.id} (${project.name}):`);
      
      const issues = await prisma.reportItemIssue.findMany({
        where: {
          OR: [
            { projectId: project.id },
            { projectId: null }
          ]
        },
        select: {
          id: true,
          summary: true,
          projectId: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 5
      });

      if (issues.length === 0) {
        console.log(`      ⚠️  이슈가 없습니다.`);
      } else {
        issues.forEach((issue, idx) => {
          console.log(`      ${idx + 1}. [projectId: ${issue.projectId || 'null'}] ${issue.summary?.substring(0, 50) || 'N/A'}...`);
        });
      }
    }

    // 5. 전체 프로젝트 선택 시 (projectId 없음)
    console.log('\n5. 전체 프로젝트 선택 시 (projectId 파라미터 없음):');
    console.log('-'.repeat(80));
    const allIssuesCount = await prisma.reportItemIssue.count();
    console.log(`   전체 이슈: ${allIssuesCount}개`);
    console.log(`   (프로젝트 필터링 없음 - 모든 이슈 포함)`);

    console.log('\n' + '='.repeat(80));
    console.log('테스트 완료!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ 테스트 중 오류 발생:', error);
    console.error('스택:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testProjectFilter();







