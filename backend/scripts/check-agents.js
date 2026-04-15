/**
 * 에이전트 계정 정보 확인 스크립트
 * 
 * 사용법:
 *   cd backend
 *   node scripts/check-agents.js
 * 
 * 옵션:
 *   --include-inactive: 비활성 에이전트도 포함
 *   --project-id <id>: 특정 프로젝트의 에이전트만 조회
 *   --format json: JSON 형식으로 출력
 */

require('dotenv').config();
const { prisma } = require('../libs/db');
const logger = require('../utils/logger');

async function checkAgents() {
  try {
    logger.info('[CheckAgents] Connecting to database...');
    await prisma.$connect();
    logger.info('[CheckAgents] Database connected successfully');

    // 명령줄 인자 파싱
    const args = process.argv.slice(2);
    const includeInactive = args.includes('--include-inactive');
    const jsonFormat = args.includes('--format') && args[args.indexOf('--format') + 1] === 'json';
    const projectIdIndex = args.indexOf('--project-id');
    const projectId = projectIdIndex !== -1 && args[projectIdIndex + 1] 
      ? parseInt(args[projectIdIndex + 1]) 
      : null;

    // 조회 조건 구성
    const where = {};
    if (!includeInactive) {
      where.isActive = true;
    }
    if (projectId !== null && !isNaN(projectId)) {
      where.projectId = projectId;
    }

    // 에이전트 조회
    const agents = await prisma.agent.findMany({
      where,
      include: {
        project: {
          select: { id: true, name: true }
        },
        user: {
          select: { id: true, email: true, name: true, role: true }
        },
        schedules: {
          where: { isActive: true },
          orderBy: [
            { dayOfWeek: 'asc' },
            { startTime: 'asc' }
          ]
        },
        _count: {
          select: {
            assignedIssues: true,
            reports: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    if (jsonFormat) {
      // JSON 형식으로 출력
      const formattedAgents = agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        department: agent.department,
        position: agent.position,
        status: agent.status,
        isActive: agent.isActive,
        handling: agent.handling,
        todayResolved: agent.todayResolved,
        avgHandleSec: agent.avgHandleSec,
        channelFocus: agent.channelFocus ? JSON.parse(agent.channelFocus) : [],
        project: agent.project ? {
          id: agent.project.id,
          name: agent.project.name
        } : null,
        user: agent.user ? {
          id: agent.user.id,
          email: agent.user.email,
          name: agent.user.name,
          role: agent.user.role
        } : null,
        schedules: agent.schedules.map(schedule => ({
          id: schedule.id,
          scheduleType: schedule.scheduleType,
          dayOfWeek: schedule.dayOfWeek,
          specificDate: schedule.specificDate,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          workType: schedule.workType
        })),
        stats: {
          assignedIssues: agent._count.assignedIssues,
          reports: agent._count.reports
        },
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString()
      }));
      console.log(JSON.stringify(formattedAgents, null, 2));
    } else {
      // 사람이 읽기 쉬운 형식으로 출력
      console.log('\n' + '='.repeat(80));
      console.log('에이전트 계정 정보');
      console.log('='.repeat(80));
      console.log(`총 ${agents.length}명의 에이전트${includeInactive ? ' (비활성 포함)' : ' (활성만)'}${projectId ? ` (프로젝트 ID: ${projectId})` : ''}`);
      console.log('='.repeat(80) + '\n');

      if (agents.length === 0) {
        console.log('에이전트가 없습니다.\n');
        return;
      }

      agents.forEach((agent, index) => {
        const channelFocus = agent.channelFocus ? JSON.parse(agent.channelFocus) : [];
        const statusEmoji = {
          'available': '🟢',
          'busy': '🟡',
          'away': '🟠',
          'offline': '⚫'
        }[agent.status] || '⚪';

        console.log(`[${index + 1}] ${agent.name} ${statusEmoji}`);
        console.log(`    ID: ${agent.id}`);
        console.log(`    상태: ${agent.status} ${agent.isActive ? '(활성)' : '(비활성)'}`);
        console.log(`    이메일: ${agent.email || '(없음)'}`);
        console.log(`    전화번호: ${agent.phone || '(없음)'}`);
        console.log(`    부서: ${agent.department || '(없음)'}`);
        console.log(`    직책: ${agent.position || '(없음)'}`);
        console.log(`    프로젝트: ${agent.project ? `${agent.project.name} (ID: ${agent.project.id})` : '(없음)'}`);
        console.log(`    사용자 계정: ${agent.user ? `${agent.user.email} (${agent.user.role})` : '(없음)'}`);
        console.log(`    담당 게임: ${channelFocus.length > 0 ? channelFocus.join(', ') : '(없음)'}`);
        console.log(`    처리 중: ${agent.handling}건`);
        console.log(`    오늘 해결: ${agent.todayResolved}건`);
        console.log(`    평균 처리 시간: ${agent.avgHandleSec}초`);
        console.log(`    배정된 이슈: ${agent._count.assignedIssues}건`);
        console.log(`    보고서: ${agent._count.reports}건`);
        
        if (agent.schedules.length > 0) {
          console.log(`    근무 스케줄:`);
          agent.schedules.forEach(schedule => {
            if (schedule.scheduleType === 'weekly') {
              const days = ['일', '월', '화', '수', '목', '금', '토'];
              console.log(`      - ${days[schedule.dayOfWeek]}요일 ${schedule.startTime} ~ ${schedule.endTime} ${schedule.workType || ''}`);
            } else if (schedule.scheduleType === 'specific') {
              console.log(`      - ${schedule.specificDate} ${schedule.startTime} ~ ${schedule.endTime} ${schedule.workType || ''}`);
            }
          });
        } else {
          console.log(`    근무 스케줄: (없음)`);
        }
        
        console.log(`    생성일: ${agent.createdAt.toISOString().split('T')[0]} ${agent.createdAt.toISOString().split('T')[1].split('.')[0]}`);
        console.log(`    수정일: ${agent.updatedAt.toISOString().split('T')[0]} ${agent.updatedAt.toISOString().split('T')[1].split('.')[0]}`);
        console.log('');
      });

      // 요약 정보
      const activeCount = agents.filter(a => a.isActive).length;
      const offlineCount = agents.filter(a => a.status === 'offline').length;
      const availableCount = agents.filter(a => a.status === 'available').length;
      const busyCount = agents.filter(a => a.status === 'busy').length;
      const withUserAccount = agents.filter(a => a.user !== null).length;

      console.log('='.repeat(80));
      console.log('요약');
      console.log('='.repeat(80));
      console.log(`활성 에이전트: ${activeCount}명`);
      console.log(`비활성 에이전트: ${agents.length - activeCount}명`);
      console.log(`사용자 계정 연결: ${withUserAccount}명`);
      console.log(`상태별:`);
      console.log(`  - 사용 가능 (available): ${availableCount}명`);
      console.log(`  - 바쁨 (busy): ${busyCount}명`);
      console.log(`  - 오프라인 (offline): ${offlineCount}명`);
      console.log(`  - 기타: ${agents.length - availableCount - busyCount - offlineCount}명`);
      console.log('='.repeat(80) + '\n');
    }

    logger.info('[CheckAgents] Script completed successfully', { count: agents.length });

  } catch (error) {
    logger.error('[CheckAgents] Script failed', { error: error.message, stack: error.stack });
    console.error('\n❌ 에러 발생:', error.message);
    if (error.stack) {
      console.error('스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    try {
      await prisma.$disconnect();
      logger.info('[CheckAgents] Database connection closed');
    } catch (disconnectError) {
      logger.warn('[CheckAgents] Error disconnecting from database', { error: disconnectError.message });
    }
  }
}

if (require.main === module) {
  checkAgents()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[CheckAgents] Unhandled error', { error: error.message });
      process.exit(1);
    });
}

module.exports = { checkAgents };









