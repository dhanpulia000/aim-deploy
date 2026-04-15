// 재분류 진행 상황 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkProgress() {
  try {
    console.log('재분류 진행 상황 확인\n');
    console.log('='.repeat(80));

    // 전체 통계
    const totalIssues = await prisma.reportItemIssue.count();
    const aiClassified = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'AI' }
    });
    const ruleClassified = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'RULE' }
    });
    const nullCategoryGroup = await prisma.reportItemIssue.count({
      where: { categoryGroupId: null }
    });

    console.log('\n1. 전체 통계:');
    console.log('-'.repeat(80));
    console.log(`전체 이슈: ${totalIssues}개`);
    console.log(`AI 분류: ${aiClassified}개 (${((aiClassified / totalIssues) * 100).toFixed(1)}%)`);
    console.log(`규칙 분류: ${ruleClassified}개 (${((ruleClassified / totalIssues) * 100).toFixed(1)}%)`);
    console.log(`대분류가 null인 이슈: ${nullCategoryGroup}개`);
    console.log('');

    // 최근 재분류된 이슈 확인
    console.log('2. 최근 AI로 분류된 이슈 (최근 10개):');
    console.log('-'.repeat(80));
    const recentAiIssues = await prisma.reportItemIssue.findMany({
      where: {
        aiClassificationMethod: 'AI',
        categoryGroupId: { not: null }
      },
      select: {
        id: true,
        summary: true,
        categoryGroup: { select: { name: true } },
        category: { select: { name: true } },
        aiClassificationMethod: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 10
    });

    if (recentAiIssues.length > 0) {
      recentAiIssues.forEach((issue, idx) => {
        console.log(`${idx + 1}. ${issue.summary?.substring(0, 50) || 'N/A'}...`);
        console.log(`   대분류: ${issue.categoryGroup?.name || 'N/A'}`);
        console.log(`   중분류: ${issue.category?.name || 'N/A'}`);
        console.log(`   업데이트: ${issue.updatedAt.toLocaleString('ko-KR')}`);
        console.log('');
      });
    } else {
      console.log('   재분류된 이슈가 아직 없습니다.');
    }

    // 대분류별 통계
    console.log('3. 대분류별 통계:');
    console.log('-'.repeat(80));
    const categoryGroupStats = await prisma.reportItemIssue.groupBy({
      by: ['categoryGroupId'],
      where: {
        categoryGroupId: { not: null }
      },
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10
    });

    for (const stat of categoryGroupStats) {
      const group = await prisma.categoryGroup.findUnique({
        where: { id: stat.categoryGroupId },
        select: { name: true }
      });
      console.log(`   ${group?.name || 'Unknown'}: ${stat._count.id}개`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ 브라우저에서 확인하려면:');
    console.log('   1. http://localhost:8080 접속');
    console.log('   2. F12로 개발자 도구 열기');
    console.log('   3. Network 탭에서 /api/issues 요청 확인');
    console.log('   4. Response에서 categoryGroup, category 필드 확인');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('에러:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkProgress();






