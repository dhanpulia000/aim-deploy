/**
 * RawLog 리셋 및 재처리 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function resetAndReprocess() {
  try {
    console.log('RawLog 리셋 및 재처리 시작...\n');

    // 1. Naver 소스의 RawLog를 isProcessed=false로 리셋
    const result = await prisma.rawLog.updateMany({
      where: { 
        source: 'naver',
        isProcessed: true
      },
      data: { 
        isProcessed: false
      }
    });

    console.log(`리셋된 RawLog: ${result.count}개`);
    console.log('\nRawLog가 리셋되었습니다. RawLogProcessor 워커가 자동으로 재처리합니다.');
    console.log('(약 30초 내에 재처리됩니다)');

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetAndReprocess();




















