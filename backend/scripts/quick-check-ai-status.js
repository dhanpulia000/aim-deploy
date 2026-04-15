// AI 재분류 결과 빠른 확인

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function quickCheck() {
  try {
    const total = await prisma.reportItemIssue.count();
    const aiCount = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'AI' } });
    const ruleCount = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'RULE' } });
    const nullCount = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: null } });

    const aiHigh = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'AI', importance: 'HIGH' } });
    const aiMedium = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'AI', importance: 'MEDIUM' } });
    const aiLow = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'AI', importance: 'LOW' } });

    console.log('=== AI 재분류 결과 ===');
    console.log(`전체: ${total}개`);
    console.log(`AI 분류: ${aiCount}개 (${((aiCount/total)*100).toFixed(1)}%)`);
    console.log(`규칙 분류: ${ruleCount}개`);
    console.log(`미분류: ${nullCount}개`);
    console.log('\n=== AI 분류 중요도 분포 ===');
    console.log(`HIGH: ${aiHigh}개`);
    console.log(`MEDIUM: ${aiMedium}개`);
    console.log(`LOW: ${aiLow}개`);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

quickCheck();







