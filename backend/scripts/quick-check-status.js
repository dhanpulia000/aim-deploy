// 빠른 상태 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function quickCheck() {
  try {
    const total = await prisma.reportItemIssue.count();
    const ai = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'AI' } });
    const rule = await prisma.reportItemIssue.count({ where: { aiClassificationMethod: 'RULE' } });
    const nullGroup = await prisma.reportItemIssue.count({ where: { categoryGroupId: null } });
    
    console.log('=== 현재 상태 ===');
    console.log(`전체 이슈: ${total}개`);
    console.log(`AI 분류: ${ai}개 (${((ai/total)*100).toFixed(1)}%)`);
    console.log(`규칙 분류: ${rule}개 (${((rule/total)*100).toFixed(1)}%)`);
    console.log(`대분류 null: ${nullGroup}개`);
    console.log('');
    console.log(`재분류 필요: ${nullGroup}개`);
    
    if (nullGroup > 0) {
      console.log('');
      console.log('재분류를 실행하려면:');
      console.log('  cd backend');
      console.log('  node scripts/reclassify-all-issues-with-ai-auto.js');
    }
  } catch (error) {
    console.error('에러:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

quickCheck();






