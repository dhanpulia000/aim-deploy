// 재분류 대상 이슈 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTargets() {
  try {
    const totalUnclassified = await prisma.reportItemIssue.count({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' },
          { categoryGroupId: null }
        ]
      }
    });

    const project2Count = await prisma.reportItemIssue.count({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' },
          { categoryGroupId: null }
        ],
        projectId: 2
      }
    });

    const project3Count = await prisma.reportItemIssue.count({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' },
          { categoryGroupId: null }
        ],
        projectId: 3
      }
    });

    const nullCategoryGroup = await prisma.reportItemIssue.count({
      where: {
        categoryGroupId: null
      }
    });

    console.log('재분류 대상 통계:');
    console.log('='.repeat(80));
    console.log(`전체 재분류 대상: ${totalUnclassified}개`);
    console.log(`- 프로젝트 ID 2: ${project2Count}개`);
    console.log(`- 프로젝트 ID 3: ${project3Count}개`);
    console.log(`- 대분류가 null인 이슈: ${nullCategoryGroup}개`);
    console.log('');

    // 샘플 확인
    const samples = await prisma.reportItemIssue.findMany({
      where: {
        OR: [
          { categoryGroupId: null },
          { aiClassificationMethod: 'RULE' }
        ]
      },
      select: {
        id: true,
        summary: true,
        categoryGroupId: true,
        categoryId: true,
        aiClassificationMethod: true,
        projectId: true
      },
      take: 5,
      orderBy: { createdAt: 'desc' }
    });

    console.log('샘플 (최근 5개):');
    samples.forEach((issue, idx) => {
      console.log(`${idx + 1}. ${issue.summary?.substring(0, 50) || 'N/A'}...`);
      console.log(`   대분류 ID: ${issue.categoryGroupId || 'null'}`);
      console.log(`   중분류 ID: ${issue.categoryId || 'null'}`);
      console.log(`   분류 방법: ${issue.aiClassificationMethod || 'null'}`);
      console.log(`   프로젝트 ID: ${issue.projectId || 'null'}`);
      console.log('');
    });

  } catch (error) {
    console.error('에러:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTargets();






