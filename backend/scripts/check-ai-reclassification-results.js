// AI 재분류 결과 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkReclassificationResults() {
  try {
    console.log('AI 재분류 결과 확인\n');
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
    console.log(`   ✅ AI 분류: ${aiClassified}개 (${totalIssues > 0 ? ((aiClassified / totalIssues) * 100).toFixed(1) : 0}%)`);
    console.log(`   📋 규칙 분류: ${ruleClassified}개 (${totalIssues > 0 ? ((ruleClassified / totalIssues) * 100).toFixed(1) : 0}%)`);
    console.log(`   ⚠️  미분류: ${unclassified}개 (${totalIssues > 0 ? ((unclassified / totalIssues) * 100).toFixed(1) : 0}%)\n`);

    // 2. AI 분류된 이슈의 중요도 분포
    console.log('2. AI 분류된 이슈의 중요도 분포:');
    console.log('-'.repeat(80));
    const aiImportanceStats = await prisma.reportItemIssue.groupBy({
      by: ['importance'],
      where: {
        aiClassificationMethod: 'AI'
      },
      _count: {
        id: true
      }
    });

    const aiImportanceMap = {
      'HIGH': 0,
      'MEDIUM': 0,
      'LOW': 0,
      'null': 0
    };

    aiImportanceStats.forEach(stat => {
      const key = stat.importance || 'null';
      if (aiImportanceMap.hasOwnProperty(key)) {
        aiImportanceMap[key] = stat._count.id;
      }
    });

    const totalAi = Object.values(aiImportanceMap).reduce((a, b) => a + b, 0);
    console.log(`   전체 AI 분류: ${totalAi}개`);
    Object.entries(aiImportanceMap).forEach(([key, count]) => {
      const percentage = totalAi > 0 ? ((count / totalAi) * 100).toFixed(1) : 0;
      console.log(`   ${key}: ${count}개 (${percentage}%)`);
    });
    console.log('');

    // 3. 프로젝트별 AI 분류 통계
    console.log('3. 프로젝트별 AI 분류 통계:');
    console.log('-'.repeat(80));
    const projectStats = await prisma.reportItemIssue.groupBy({
      by: ['projectId', 'aiClassificationMethod', 'importance'],
      _count: {
        id: true
      }
    });

    const projectMap = new Map();
    projectStats.forEach(stat => {
      const key = stat.projectId || 'null';
      const method = stat.aiClassificationMethod || 'null';
      const importance = stat.importance || 'null';
      
      if (!projectMap.has(key)) {
        projectMap.set(key, {
          projectId: stat.projectId,
          ai: { HIGH: 0, MEDIUM: 0, LOW: 0 },
          rule: { HIGH: 0, MEDIUM: 0, LOW: 0 },
          null: { HIGH: 0, MEDIUM: 0, LOW: 0 }
        });
      }
      
      const item = projectMap.get(key);
      if (item[method] && item[method].hasOwnProperty(importance)) {
        item[method][importance] = stat._count.id;
      }
    });

    for (const [key, stats] of projectMap.entries()) {
      const totalAi = stats.ai.HIGH + stats.ai.MEDIUM + stats.ai.LOW;
      const totalRule = stats.rule.HIGH + stats.rule.MEDIUM + stats.rule.LOW;
      const totalNull = stats.null.HIGH + stats.null.MEDIUM + stats.null.LOW;
      const total = totalAi + totalRule + totalNull;

      console.log(`   프로젝트 ID: ${key}`);
      console.log(`   AI 분류 (${totalAi}개):`);
      console.log(`      HIGH: ${stats.ai.HIGH}개, MEDIUM: ${stats.ai.MEDIUM}개, LOW: ${stats.ai.LOW}개`);
      console.log(`   규칙 분류 (${totalRule}개):`);
      console.log(`      HIGH: ${stats.rule.HIGH}개, MEDIUM: ${stats.rule.MEDIUM}개, LOW: ${stats.rule.LOW}개`);
      console.log(`   미분류 (${totalNull}개):`);
      console.log(`      HIGH: ${stats.null.HIGH}개, MEDIUM: ${stats.null.MEDIUM}개, LOW: ${stats.null.LOW}개`);
      console.log(`   전체: ${total}개\n`);
    }

    // 4. 최근 AI 분류된 이슈 샘플
    console.log('4. 최근 AI 분류된 이슈 샘플 (최근 10개):');
    console.log('-'.repeat(80));
    const recentAiIssues = await prisma.reportItemIssue.findMany({
      where: {
        aiClassificationMethod: 'AI'
      },
      select: {
        id: true,
        summary: true,
        importance: true,
        severity: true,
        aiClassificationReason: true,
        categoryGroup: {
          select: { name: true }
        },
        category: {
          select: { name: true }
        },
        projectId: true,
        updatedAt: true
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: 10
    });

    if (recentAiIssues.length === 0) {
      console.log('   ⚠️  AI로 분류된 이슈가 없습니다.\n');
    } else {
      recentAiIssues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. [${issue.importance}] ${issue.summary?.substring(0, 50) || 'N/A'}...`);
        console.log(`      대분류: ${issue.categoryGroup?.name || 'N/A'}, 중분류: ${issue.category?.name || 'N/A'}`);
        console.log(`      심각도: ${issue.severity || 'N/A'}`);
        if (issue.aiClassificationReason) {
          console.log(`      AI 이유: ${issue.aiClassificationReason.substring(0, 60)}...`);
        }
        console.log(`      업데이트: ${issue.updatedAt.toLocaleString('ko-KR')}`);
        console.log('');
      });
    }

    console.log('='.repeat(80));
    console.log('결과 확인 완료!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ 확인 중 오류 발생:', error);
    console.error('스택:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkReclassificationResults();







