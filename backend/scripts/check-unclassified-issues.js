// AI가 분류하지 않은 이슈들 확인 및 중요도 분포 분석

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUnclassifiedIssues() {
  try {
    console.log('AI가 분류하지 않은 이슈 분석\n');
    console.log('='.repeat(80));

    // 1. 전체 통계
    console.log('\n1. 전체 이슈 통계:');
    console.log('-'.repeat(80));
    const totalIssues = await prisma.reportItemIssue.count();
    const aiClassified = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'AI' }
    });
    const ruleClassified = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'RULE' }
    });
    const unclassified = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: null }
    });

    console.log(`   전체 이슈: ${totalIssues}개`);
    console.log(`   AI 분류: ${aiClassified}개`);
    console.log(`   규칙 분류: ${ruleClassified}개`);
    console.log(`   미분류: ${unclassified}개\n`);

    // 2. 중요도별 분포 (AI 분류 안된 이슈)
    console.log('2. AI 분류 안된 이슈의 중요도 분포:');
    console.log('-'.repeat(80));
    const importanceStats = await prisma.reportItemIssue.groupBy({
      by: ['importance', 'aiClassificationMethod'],
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' }
        ]
      },
      _count: {
        id: true
      }
    });

    const importanceMap = {
      'HIGH': 0,
      'MEDIUM': 0,
      'LOW': 0,
      'null': 0
    };

    importanceStats.forEach(stat => {
      const key = stat.importance || 'null';
      if (importanceMap.hasOwnProperty(key)) {
        importanceMap[key] += stat._count.id;
      }
    });

    const totalUnclassified = Object.values(importanceMap).reduce((a, b) => a + b, 0);
    console.log(`   전체 (AI 미분류): ${totalUnclassified}개`);
    Object.entries(importanceMap).forEach(([key, count]) => {
      const percentage = totalUnclassified > 0 ? ((count / totalUnclassified) * 100).toFixed(1) : 0;
      console.log(`   ${key}: ${count}개 (${percentage}%)`);
    });
    console.log('');

    // 3. 최근 AI 미분류 이슈 샘플
    console.log('3. 최근 AI 미분류 이슈 샘플 (최근 20개):');
    console.log('-'.repeat(80));
    const recentUnclassified = await prisma.reportItemIssue.findMany({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' }
        ]
      },
      select: {
        id: true,
        summary: true,
        detail: true,
        importance: true,
        severity: true,
        aiClassificationMethod: true,
        categoryGroup: {
          select: { name: true }
        },
        category: {
          select: { name: true }
        },
        projectId: true,
        createdAt: true,
        source: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20
    });

    console.log(`   샘플 ${recentUnclassified.length}개:\n`);
    recentUnclassified.forEach((issue, idx) => {
      const text = `${issue.summary || ''} ${issue.detail || ''}`.substring(0, 60);
      console.log(`   ${idx + 1}. [${issue.aiClassificationMethod || 'NULL'}] 중요도: ${issue.importance || 'null'}`);
      console.log(`      제목: ${text}...`);
      console.log(`      프로젝트 ID: ${issue.projectId || 'null'}`);
      console.log(`      대분류: ${issue.categoryGroup?.name || 'N/A'}`);
      console.log(`      중분류: ${issue.category?.name || 'N/A'}`);
      console.log(`      심각도: ${issue.severity || 'N/A'}`);
      console.log(`      생성일: ${issue.createdAt.toLocaleString('ko-KR')}`);
      console.log('');
    });

    // 4. 프로젝트별 통계
    console.log('4. 프로젝트별 AI 미분류 이슈 통계:');
    console.log('-'.repeat(80));
    const projectStats = await prisma.reportItemIssue.groupBy({
      by: ['projectId', 'importance'],
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' }
        ]
      },
      _count: {
        id: true
      }
    });

    const projectMap = new Map();
    projectStats.forEach(stat => {
      const key = stat.projectId || 'null';
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectId: stat.projectId, HIGH: 0, MEDIUM: 0, LOW: 0, null: 0 });
      }
      const item = projectMap.get(key);
      const importanceKey = stat.importance || 'null';
      if (item.hasOwnProperty(importanceKey)) {
        item[importanceKey] = stat._count.id;
      }
    });

    for (const [key, stats] of projectMap.entries()) {
      const total = stats.HIGH + stats.MEDIUM + stats.LOW + stats.null;
      console.log(`   프로젝트 ID: ${key}`);
      console.log(`      HIGH: ${stats.HIGH}개`);
      console.log(`      MEDIUM: ${stats.MEDIUM}개 (${total > 0 ? ((stats.MEDIUM / total) * 100).toFixed(1) : 0}%)`);
      console.log(`      LOW: ${stats.LOW}개`);
      console.log(`      null: ${stats.null}개`);
      console.log(`      전체: ${total}개\n`);
    }

    console.log('='.repeat(80));
    console.log('분석 완료!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ 분석 중 오류 발생:', error);
    console.error('스택:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkUnclassifiedIssues();







