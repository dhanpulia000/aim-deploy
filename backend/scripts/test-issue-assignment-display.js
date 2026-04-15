/**
 * 이슈 상세창 담당 에이전트 표시 테스트
 */

require('dotenv').config();
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function testIssueAssignmentDisplay() {
  console.log('=== 이슈 상세창 담당 에이전트 표시 테스트 ===\n');

  // 1. 테스트용 이슈 생성 (스케줄에 맞는 시간으로)
  console.log('1. 테스트용 이슈 생성:');
  
  // 오늘 날짜의 스케줄 확인
  const today = new Date();
  const kstToday = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kstToday.toISOString().split('T')[0];
  const currentHour = kstToday.getUTCHours();
  
  console.log(`   오늘 날짜 (KST): ${todayStr}, 현재 시간: ${currentHour}시`);
  
  // 해당 시간에 근무 중인 에이전트 찾기
  const schedules = query(`
    SELECT s.*, a.id as agentId, a.name as agentName
    FROM AgentSchedule s
    JOIN Agent a ON s.agentId = a.id
    WHERE s.isActive = 1 
      AND a.isActive = 1
      AND s.scheduleType = 'specific'
      AND s.specificDate = ?
  `, [todayStr]);
  
  let testAgentId = null;
  let testAgentName = null;
  
  for (const schedule of schedules) {
    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    const startTimeInMinutes = startHour * 60 + startMinute;
    const endTimeInMinutes = endHour * 60 + endMinute;
    const isOvernight = endTimeInMinutes < startTimeInMinutes;
    const currentTimeInMinutes = currentHour * 60;
    
    let isMatch = false;
    if (isOvernight) {
      isMatch = currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
    } else {
      isMatch = currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
    }
    
    if (isMatch) {
      testAgentId = schedule.agentId;
      testAgentName = schedule.agentName;
      console.log(`   ✅ 근무 중인 에이전트 발견: ${testAgentName} (${schedule.startTime}-${schedule.endTime})`);
      break;
    }
  }
  
  if (!testAgentId) {
    console.log('   ⚠️  현재 시간에 근무 중인 에이전트가 없습니다.');
    console.log('   → 다음 스케줄 확인 중...');
    
    // 내일 스케줄 확인
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const kstTomorrow = new Date(tomorrow.getTime() + 9 * 60 * 60 * 1000);
    const tomorrowStr = kstTomorrow.toISOString().split('T')[0];
    
    const tomorrowSchedules = query(`
      SELECT s.*, a.id as agentId, a.name as agentName
      FROM AgentSchedule s
      JOIN Agent a ON s.agentId = a.id
      WHERE s.isActive = 1 
        AND a.isActive = 1
        AND s.scheduleType = 'specific'
        AND s.specificDate = ?
      LIMIT 1
    `, [tomorrowStr]);
    
    if (tomorrowSchedules.length > 0) {
      testAgentId = tomorrowSchedules[0].agentId;
      testAgentName = tomorrowSchedules[0].agentName;
      console.log(`   ✅ 내일 스케줄 사용: ${testAgentName}`);
    }
  }
  
  if (!testAgentId) {
    console.log('   ❌ 테스트할 수 있는 스케줄이 없습니다.');
    return;
  }

  // 2. 테스트 이슈에 에이전트 할당
  console.log('\n2. 테스트 이슈에 에이전트 할당:');
  const testIssue = queryOne(`
    SELECT id, summary, assignedAgentId
    FROM ReportItemIssue
    WHERE assignedAgentId IS NULL
    ORDER BY createdAt DESC
    LIMIT 1
  `);
  
  if (!testIssue) {
    console.log('   ❌ 테스트할 이슈가 없습니다.');
    return;
  }
  
  console.log(`   이슈 ID: ${testIssue.id}`);
  console.log(`   제목: ${testIssue.summary?.substring(0, 50)}`);
  console.log(`   현재 할당: ${testIssue.assignedAgentId || '없음'}`);
  
  // 에이전트 할당
  const now = new Date().toISOString();
  execute(
    'UPDATE ReportItemIssue SET assignedAgentId = ?, updatedAt = ? WHERE id = ?',
    [testAgentId, now, testIssue.id]
  );
  
  console.log(`   ✅ 에이전트 할당 완료: ${testAgentName}`);
  
  // 3. 할당 확인
  console.log('\n3. 할당 확인:');
  const updatedIssue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [testIssue.id]);
  const assignedAgent = queryOne('SELECT id, name FROM Agent WHERE id = ?', [updatedIssue.assignedAgentId]);
  
  console.log(`   assignedAgentId: ${updatedIssue.assignedAgentId}`);
  console.log(`   에이전트 이름: ${assignedAgent?.name || 'N/A'}`);
  
  // 4. API 응답 형식 확인
  console.log('\n4. API 응답 형식 확인:');
  const apiFormat = {
    id: updatedIssue.id,
    assignedAgentId: updatedIssue.assignedAgentId,
    assignedAgentName: assignedAgent?.name || null,
    assignedAgent: updatedIssue.assignedAgentId ? {
      id: updatedIssue.assignedAgentId,
      name: assignedAgent?.name
    } : null
  };
  
  console.log('   API 응답 형식:');
  console.log(JSON.stringify(apiFormat, null, 2));
  
  console.log('\n=== 테스트 완료 ===');
  console.log(`\n✅ 이슈 상세창에서 "${assignedAgent?.name}" 에이전트가 표시되어야 합니다.`);
  console.log(`   이슈 ID: ${testIssue.id}`);
}

if (require.main === module) {
  testIssueAssignmentDisplay().catch(error => {
    console.error('테스트 실패:', error);
    process.exit(1);
  });
}

module.exports = { testIssueAssignmentDisplay };











