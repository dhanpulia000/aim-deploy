require('dotenv').config();
const { prisma } = require('../libs/db');

async function checkRawLogContent() {
  try {
    const logs = await prisma.rawLog.findMany({
      where: {
        source: 'naver',
        isProcessed: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    console.log(`\n총 ${logs.length}개의 RawLog를 찾았습니다.\n`);

    logs.forEach((log, i) => {
      console.log('='.repeat(80));
      console.log(`[${i+1}] RawLog ID: ${log.id}`);
      console.log(`생성일: ${log.createdAt}`);
      console.log(`\n--- Content (본문) ---`);
      console.log(`"${log.content}"`);
      console.log(`Content 길이: ${log.content?.length || 0}자`);
      
      try {
        const meta = JSON.parse(log.metadata || '{}');
        console.log(`\n--- Metadata ---`);
        console.log(`Title: "${meta.title || '(없음)'}"`);
        console.log(`URL: ${meta.url || '(없음)'}`);
        console.log(`CafeGame: ${meta.cafeGame || '(없음)'}`);
      } catch (e) {
        console.log(`Metadata 파싱 실패: ${e.message}`);
      }
      console.log('');
    });

    await prisma.$disconnect();
  } catch (error) {
    console.error('에러:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkRawLogContent();


















