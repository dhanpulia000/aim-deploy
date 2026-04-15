// 스케줄 날짜 수정 스크립트
// UTC 변환으로 인해 하루 전으로 저장된 날짜를 수정

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 날짜 문자열을 하루 앞당김 (UTC 변환 문제 수정)
 * 예: "2025-01-14" -> "2025-01-15"
 */
function addOneDay(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fixScheduleDates() {
  try {
    console.log('스케줄 날짜 수정 중...\n');
    
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
        agent: {
          select: {
            name: true
          }
        }
      }
    });

    console.log(`총 ${schedules.length}개의 특정 날짜 스케줄 발견\n`);

    if (schedules.length === 0) {
      console.log('수정할 스케줄이 없습니다.');
      return;
    }

    let fixedCount = 0;
    const fixes = [];

    for (const schedule of schedules) {
      const oldDate = schedule.specificDate;
      const newDate = addOneDay(oldDate);
      
      // 날짜가 다르면 수정
      if (oldDate !== newDate) {
        fixes.push({
          id: schedule.id,
          oldDate,
          newDate,
          agentName: schedule.agent?.name || schedule.agentId
        });
      }
    }

    if (fixes.length === 0) {
      console.log('수정할 스케줄이 없습니다. 모든 날짜가 정상입니다.\n');
      return;
    }

    console.log(`수정할 스케줄 ${fixes.length}개:`);
    console.log('='.repeat(80));
    fixes.forEach((fix, index) => {
      console.log(`${index + 1}. ID: ${fix.id}`);
      console.log(`   에이전트: ${fix.agentName}`);
      console.log(`   ${fix.oldDate} -> ${fix.newDate}`);
    });
    console.log('='.repeat(80));
    // 실제 수정 실행
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('\n⚠️  경고: 이 작업은 되돌릴 수 없습니다!\n수정을 계속하시겠습니까? (yes 입력): ', async (answer) => {
      if (answer.toLowerCase() === 'yes') {
        console.log('\n수정 중...');
        for (const fix of fixes) {
          await prisma.agentSchedule.update({
            where: { id: fix.id },
            data: { specificDate: fix.newDate }
          });
          fixedCount++;
        }
        console.log(`\n✅ ${fixedCount}개의 스케줄 날짜가 수정되었습니다.`);
      } else {
        console.log('\n❌ 수정이 취소되었습니다.');
      }
      rl.close();
      await prisma.$disconnect();
    });

  } catch (error) {
    console.error('오류 발생:', error);
    await prisma.$disconnect();
  }
}

fixScheduleDates();

