// 스케줄 날짜 확인 스크립트
// UTC 변환 문제로 인한 날짜 오차 확인

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkScheduleDates() {
  try {
    console.log('스케줄 날짜 확인 중...\n');
    
    // specific 타입 스케줄만 조회
    const schedules = await prisma.agentSchedule.findMany({
      where: {
        scheduleType: 'specific',
        specificDate: { not: null }
      },
      select: {
        id: true,
        agentId: true,
        specificDate: true,
        createdAt: true,
        agent: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`총 ${schedules.length}개의 특정 날짜 스케줄 발견\n`);

    if (schedules.length === 0) {
      console.log('확인할 스케줄이 없습니다.');
      return;
    }

    console.log('스케줄 목록:');
    console.log('=' .repeat(80));
    schedules.forEach((schedule, index) => {
      console.log(`${index + 1}. ID: ${schedule.id}`);
      console.log(`   에이전트: ${schedule.agent?.name || schedule.agentId}`);
      console.log(`   저장된 날짜: ${schedule.specificDate}`);
      console.log(`   생성 시간: ${schedule.createdAt}`);
      console.log('');
    });

    console.log('='.repeat(80));
    console.log('\n주의:');
    console.log('- 저장된 날짜가 예상과 다르면 마이그레이션이 필요할 수 있습니다.');
    console.log('- 날짜 형식은 YYYY-MM-DD여야 합니다.');
    console.log('- 문제가 있는 날짜는 날짜 선택 시 UTC 변환으로 인해 하루 전으로 저장되었을 수 있습니다.\n');

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkScheduleDates();







