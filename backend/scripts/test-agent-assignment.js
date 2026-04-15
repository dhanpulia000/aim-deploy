/**
 * 에이전트 스케줄 기반 자동 할당 테스트 스크립트
 */

require('dotenv').config();
const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');

// findAgentByWorkSchedule 함수를 직접 구현 (테스트용)
async function findAgentByWorkSchedule(targetTime, projectId = null) {
  if (!targetTime || !(targetTime instanceof Date) || isNaN(targetTime.getTime())) {
    return null;
  }

  try {
    // UTC 시간을 한국 시간(KST, UTC+9)으로 변환
    const kstTime = new Date(targetTime.getTime() + 9 * 60 * 60 * 1000);
    
    // 시간 파싱 (HH:mm 형식) - KST 기준
    const hour = kstTime.getUTCHours();
    const minute = kstTime.getUTCMinutes();
    const timeInMinutes = hour * 60 + minute;
    
    // 요일 확인 (0=일요일, 1=월요일, ..., 6=토요일) - KST 기준
    const dayOfWeek = kstTime.getUTCDay();
    
    // 날짜 확인 (YYYY-MM-DD 형식) - KST 기준
    const dateStr = kstTime.toISOString().split('T')[0];
    
    // 프로젝트에 속한 활성 에이전트 조회
    let agentsQuery = `
      SELECT DISTINCT a.id, a.name, a.projectId
      FROM Agent a
      WHERE a.isActive = 1
    `;
    const agentsParams = [];
    
    if (projectId) {
      agentsQuery += ' AND a.projectId = ?';
      agentsParams.push(projectId);
    }
    
    const agents = query(agentsQuery, agentsParams);
    
    if (agents.length === 0) {
      return null;
    }
    
    const agentIds = agents.map(a => a.id);
    const placeholders = agentIds.map(() => '?').join(',');
    
    // 해당 시간에 근무 중인 스케줄 찾기
    const schedules = query(
      `SELECT s.*, a.projectId
       FROM AgentSchedule s
       JOIN Agent a ON s.agentId = a.id
       WHERE s.agentId IN (${placeholders})
         AND s.isActive = 1
         AND a.isActive = 1`,
      agentIds
    );
    
    const matchingAgents = [];
    
    for (const schedule of schedules) {
      let isMatch = false;
      
      // 시간 파싱 (HH:mm 형식)
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      const startTimeInMinutes = startHour * 60 + startMinute;
      const endTimeInMinutes = endHour * 60 + endMinute;
      
      // 야간 근무 체크 (22:00-07:00 같은 경우)
      const isOvernight = endTimeInMinutes < startTimeInMinutes;
      
      if (schedule.scheduleType === 'weekly') {
        // 주간 반복 스케줄
        if (schedule.dayOfWeek === dayOfWeek) {
          if (isOvernight) {
            // 야간 근무: 시작 시간 이후 또는 종료 시간 이전
            isMatch = timeInMinutes >= startTimeInMinutes || timeInMinutes <= endTimeInMinutes;
          } else {
            // 일반 근무: 시작 시간과 종료 시간 사이
            isMatch = timeInMinutes >= startTimeInMinutes && timeInMinutes <= endTimeInMinutes;
          }
        }
      } else if (schedule.scheduleType === 'specific') {
        // 특정 날짜 스케줄
        if (schedule.specificDate === dateStr) {
          if (isOvernight) {
            // 야간 근무: 시작 시간 이후 또는 종료 시간 이전
            isMatch = timeInMinutes >= startTimeInMinutes || timeInMinutes <= endTimeInMinutes;
          } else {
            // 일반 근무: 시작 시간과 종료 시간 사이
            isMatch = timeInMinutes >= startTimeInMinutes && timeInMinutes <= endTimeInMinutes;
          }
        }
      }
      
      if (isMatch) {
        matchingAgents.push({
          agentId: schedule.agentId,
          agentName: agents.find(a => a.id === schedule.agentId)?.name || 'Unknown',
          projectId: schedule.projectId
        });
      }
    }
    
    if (matchingAgents.length === 0) {
      return null;
    }
    
    // 여러 에이전트가 매칭되면 우선순위 적용
    let selectedAgent = null;
    
    if (projectId) {
      const projectAgents = matchingAgents.filter(a => a.projectId === projectId);
      if (projectAgents.length > 0) {
        matchingAgents.splice(0, matchingAgents.length, ...projectAgents);
      }
    }
    
    // 할당된 이슈 수 확인
    const agentIssueCounts = {};
    for (const agent of matchingAgents) {
      const count = queryOne(
        'SELECT COUNT(*) as count FROM ReportItemIssue WHERE assignedAgentId = ? AND status != ?',
        [agent.agentId, 'RESOLVED']
      );
      agentIssueCounts[agent.agentId] = count?.count || 0;
    }
    
    // 이슈 수가 가장 적은 에이전트 선택
    selectedAgent = matchingAgents.reduce((prev, curr) => {
      const prevCount = agentIssueCounts[prev.agentId] || 0;
      const currCount = agentIssueCounts[curr.agentId] || 0;
      return currCount < prevCount ? curr : prev;
    });
    
    return selectedAgent.agentId;
  } catch (error) {
    logger.error('[Test] Failed to find agent by work schedule', {
      error: error.message,
      targetTime: targetTime?.toISOString()
    });
    return null;
  }
}

async function testAgentAssignment() {
  console.log('=== 에이전트 스케줄 기반 자동 할당 테스트 ===\n');

  // 1. 활성 스케줄 확인
  console.log('1. 활성 스케줄 확인:');
  const schedules = query(`
    SELECT s.*, a.name as agentName, a.projectId
    FROM AgentSchedule s
    JOIN Agent a ON s.agentId = a.id
    WHERE s.isActive = 1 AND a.isActive = 1
    ORDER BY a.name, s.scheduleType, s.specificDate, s.dayOfWeek
    LIMIT 10
  `);
  
  schedules.forEach((s, i) => {
    const scheduleInfo = s.scheduleType === 'weekly' 
      ? `주간 (요일: ${s.dayOfWeek})`
      : `특정 날짜 (${s.specificDate})`;
    console.log(`   ${i+1}. [${s.agentName}] ${scheduleInfo} - ${s.startTime}~${s.endTime}`);
  });
  console.log(`\n   총 ${schedules.length}개 스케줄 확인\n`);

  // 2. 다양한 시간대 테스트
  console.log('2. 다양한 시간대 테스트:');
  const testTimes = [
    new Date('2025-12-17T05:00:00Z'), // UTC 05:00 = KST 14:00
    new Date('2025-12-17T06:00:00Z'), // UTC 06:00 = KST 15:00
    new Date('2025-12-17T14:00:00Z'), // UTC 14:00 = KST 23:00
    new Date('2025-12-17T15:00:00Z'), // UTC 15:00 = KST 00:00 (다음날)
    new Date('2025-12-18T05:00:00Z'), // UTC 05:00 = KST 14:00 (다음날)
  ];

  for (const testTime of testTimes) {
    const kstTime = new Date(testTime.getTime() + 9 * 60 * 60 * 1000);
    const kstHour = kstTime.getUTCHours();
    const kstMinute = kstTime.getUTCMinutes();
    const kstDateStr = kstTime.toISOString().split('T')[0];
    
    console.log(`\n   테스트 시간: ${testTime.toISOString()}`);
    console.log(`   → KST: ${kstDateStr} ${String(kstHour).padStart(2, '0')}:${String(kstMinute).padStart(2, '0')}`);
    
    try {
      const assignedAgentId = await findAgentByWorkSchedule(testTime, null);
      if (assignedAgentId) {
        const agent = queryOne('SELECT name, projectId FROM Agent WHERE id = ?', [assignedAgentId]);
        console.log(`   ✅ 할당된 에이전트: ${agent?.name || assignedAgentId} (프로젝트: ${agent?.projectId || 'N/A'})`);
      } else {
        console.log(`   ❌ 할당된 에이전트 없음`);
      }
    } catch (error) {
      console.log(`   ❌ 에러: ${error.message}`);
    }
  }

  // 3. 실제 이슈의 sourceCreatedAt으로 테스트
  console.log('\n\n3. 실제 이슈의 sourceCreatedAt으로 테스트:');
  const recentIssues = query(`
    SELECT id, summary, sourceCreatedAt, assignedAgentId, projectId
    FROM ReportItemIssue
    WHERE sourceCreatedAt IS NOT NULL
    ORDER BY createdAt DESC
    LIMIT 5
  `);

  for (const issue of recentIssues) {
    if (!issue.sourceCreatedAt) continue;
    
    const sourceTime = new Date(issue.sourceCreatedAt);
    const kstTime = new Date(sourceTime.getTime() + 9 * 60 * 60 * 1000);
    const kstDateStr = kstTime.toISOString().split('T')[0];
    const kstHour = kstTime.getUTCHours();
    const kstMinute = kstTime.getUTCMinutes();
    
    console.log(`\n   이슈: ${(issue.summary || '').substring(0, 40)}`);
    console.log(`   sourceCreatedAt: ${issue.sourceCreatedAt}`);
    console.log(`   → KST: ${kstDateStr} ${String(kstHour).padStart(2, '0')}:${String(kstMinute).padStart(2, '0')}`);
    console.log(`   현재 할당: ${issue.assignedAgentId || '없음'}`);
    
    try {
      const assignedAgentId = await findAgentByWorkSchedule(sourceTime, issue.projectId);
      if (assignedAgentId) {
        const agent = queryOne('SELECT name FROM Agent WHERE id = ?', [assignedAgentId]);
        console.log(`   ✅ 예상 할당: ${agent?.name || assignedAgentId}`);
        if (assignedAgentId !== issue.assignedAgentId) {
          console.log(`   ⚠️  현재 할당과 다름 (업데이트 필요)`);
        }
      } else {
        console.log(`   ❌ 할당 가능한 에이전트 없음`);
      }
    } catch (error) {
      console.log(`   ❌ 에러: ${error.message}`);
    }
  }

  console.log('\n\n=== 테스트 완료 ===');
}

if (require.main === module) {
  testAgentAssignment().catch(error => {
    console.error('테스트 실패:', error);
    process.exit(1);
  });
}

module.exports = { testAgentAssignment };

