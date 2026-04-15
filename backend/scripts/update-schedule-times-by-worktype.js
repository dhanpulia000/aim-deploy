/**
 * 기존 스케줄들의 workType에 맞게 시간을 자동으로 업데이트하는 스크립트
 * 
 * 사용법:
 * node backend/scripts/update-schedule-times-by-worktype.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 근무 타입별 기본 시간 설정 (Admin.tsx와 동일)
const WORK_TYPE_TIMES = {
  "주간": { startTime: "07:00", endTime: "16:00" },
  "오후": { startTime: "14:00", endTime: "23:00" },
  "야간": { startTime: "22:00", endTime: "07:00" },
  "정오": { startTime: "12:00", endTime: "21:00" },
};

async function updateScheduleTimes() {
  try {
    console.log('기존 스케줄의 workType에 맞게 시간을 업데이트합니다...\n');

    // workType이 있는 모든 스케줄 조회
    const schedules = await prisma.agentSchedule.findMany({
      where: {
        workType: {
          not: null,
        },
        isActive: true,
      },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    console.log(`총 ${schedules.length}개의 스케줄을 확인했습니다.\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    const updates = [];

    for (const schedule of schedules) {
      const workType = schedule.workType;
      
      if (!workType || !WORK_TYPE_TIMES[workType]) {
        console.log(`  [스킵] ID: ${schedule.id}, workType: ${workType || 'null'} (정의되지 않은 workType)`);
        skippedCount++;
        continue;
      }

      const expectedTimes = WORK_TYPE_TIMES[workType];
      const currentStartTime = schedule.startTime;
      const currentEndTime = schedule.endTime;

      // 이미 올바른 시간이면 스킵
      if (currentStartTime === expectedTimes.startTime && currentEndTime === expectedTimes.endTime) {
        console.log(`  [스킵] ID: ${schedule.id}, ${schedule.agent.name}, ${workType}: ${currentStartTime}-${currentEndTime} (이미 올바른 시간)`);
        skippedCount++;
        continue;
      }

      // 시간 업데이트
      await prisma.agentSchedule.update({
        where: { id: schedule.id },
        data: {
          startTime: expectedTimes.startTime,
          endTime: expectedTimes.endTime,
        },
      });

      console.log(`  [업데이트] ID: ${schedule.id}, ${schedule.agent.name}, ${workType}: ${currentStartTime}-${currentEndTime} → ${expectedTimes.startTime}-${expectedTimes.endTime}`);
      
      updates.push({
        id: schedule.id,
        agentName: schedule.agent.name,
        workType,
        oldTime: `${currentStartTime}-${currentEndTime}`,
        newTime: `${expectedTimes.startTime}-${expectedTimes.endTime}`,
      });
      
      updatedCount++;
    }

    console.log('\n=== 업데이트 완료 ===');
    console.log(`총 ${schedules.length}개 스케줄 중:`);
    console.log(`  - 업데이트: ${updatedCount}개`);
    console.log(`  - 스킵: ${skippedCount}개`);

    if (updates.length > 0) {
      console.log('\n업데이트된 스케줄 목록:');
      updates.forEach((update, idx) => {
        console.log(`  ${idx + 1}. ${update.agentName} (${update.workType}): ${update.oldTime} → ${update.newTime}`);
      });
    }

  } catch (error) {
    console.error('오류 발생:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 스크립트 실행
updateScheduleTimes()
  .then(() => {
    console.log('\n스크립트가 성공적으로 완료되었습니다.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('스크립트 실행 중 오류:', error);
    process.exit(1);
  });






