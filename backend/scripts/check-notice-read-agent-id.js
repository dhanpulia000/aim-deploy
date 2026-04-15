/**
 * 공지 열람 시 "에이전트 ID가 필요합니다" 오류 원인 점검 스크립트
 *
 * markNoticeAsRead API는 agentId가 없을 때:
 * 1) req.user.id → Agent.userId로 조회
 * 2) req.user.name → Agent.name으로 조회 (fallback)
 *
 * 이 스크립트는 위 조건으로 Agent를 찾을 수 없는 계정을 찾습니다.
 *
 * 사용법:
 *   cd backend
 *   node scripts/check-notice-read-agent-id.js
 */

require('dotenv').config();
const { query, queryOne } = require('../libs/db');

function checkNoticeReadAgentIds() {
  console.log('\n' + '='.repeat(80));
  console.log('공지 열람 시 에이전트 ID 점검');
  console.log('="에이전트 ID가 필요합니다" 오류가 발생하는 계정 식별');
  console.log('='.repeat(80) + '\n');

  // 1. User 테이블 조회 (로그인 가능한 모든 사용자)
  const users = query('SELECT id, email, name, role FROM User');
  if (users.length === 0) {
    console.log('❌ User 계정이 없습니다.\n');
    return;
  }

  // 2. Agent 테이블 조회 (활성 에이전트)
  const agents = query(
    'SELECT id, name, userId, projectId, isActive FROM Agent WHERE isActive = 1'
  );
  const allAgents = query(
    'SELECT id, name, userId, projectId, isActive FROM Agent'
  );

  console.log(`총 User: ${users.length}명, 활성 Agent: ${agents.length}명\n`);

  const issues = [];
  const okUsers = [];

  for (const user of users) {
    // markNoticeAsRead 로직: agentId 없을 때
    // 1) userId로 Agent 찾기
    let agent = queryOne(
      'SELECT id, name FROM Agent WHERE userId = ? AND isActive = 1',
      [user.id]
    );
    // 2) name으로 Agent 찾기 (fallback)
    if (!agent && user.name) {
      agent = queryOne(
        'SELECT id, name FROM Agent WHERE name = ? AND isActive = 1',
        [user.name]
      );
    }

    if (!agent) {
      issues.push({
        type: 'NO_AGENT',
        user,
        reason:
          !user.name
            ? 'User.name이 비어있음'
            : 'Agent에 userId 연결 없음 + Agent.name과 User.name 불일치'
      });
    } else {
      // userId로 찾았는지, name으로 찾았는지 구분
      const byUserId = queryOne(
        'SELECT id FROM Agent WHERE userId = ? AND isActive = 1',
        [user.id]
      );
      okUsers.push({
        user,
        agent,
        foundBy: byUserId ? 'userId' : 'name'
      });
    }
  }

  // 3. Agent는 있지만 User가 없는 경우 (로그인 불가)
  const agentsWithoutUser = allAgents.filter((a) => !a.userId);
  const activeAgentsWithoutUser = agentsWithoutUser.filter((a) => a.isActive);

  // 4. User.name과 Agent.name 불일치 (userId로 연결된 경우는 괜찮음)
  const nameMismatches = [];
  for (const u of users) {
    const agentByUserId = queryOne(
      'SELECT id, name FROM Agent WHERE userId = ? AND isActive = 1',
      [u.id]
    );
    if (agentByUserId && u.name && agentByUserId.name !== u.name) {
      nameMismatches.push({
        user: u,
        agent: agentByUserId,
        userName: u.name,
        agentName: agentByUserId.name
      });
    }
  }

  // 결과 출력
  if (issues.length > 0) {
    console.log('❌ 공지 열람 시 "에이전트 ID가 필요합니다" 오류 발생 가능 계정:');
    console.log('-'.repeat(80));
    issues.forEach((item, i) => {
      console.log(`\n${i + 1}. User ID: ${item.user.id}`);
      console.log(`   이메일: ${item.user.email}`);
      console.log(`   이름: ${item.user.name || '(비어있음)'}`);
      console.log(`   역할: ${item.user.role}`);
      console.log(`   원인: ${item.reason}`);
    });
    console.log('\n');
  } else {
    console.log('✅ 모든 User 계정이 Agent와 연결되어 있습니다.\n');
  }

  if (activeAgentsWithoutUser.length > 0) {
    console.log('⚠️  User 계정 없이 활성화된 에이전트 (로그인 불가, 공지 열람 불가):');
    console.log('-'.repeat(80));
    activeAgentsWithoutUser.forEach((a, i) => {
      console.log(`  ${i + 1}. Agent ID: ${a.id}, 이름: ${a.name}`);
    });
    console.log('');
  }

  if (nameMismatches.length > 0) {
    console.log('ℹ️  User.name과 Agent.name 불일치 (userId로 연결되어 있어 공지 열람은 가능):');
    console.log('-'.repeat(80));
    nameMismatches.forEach((m, i) => {
      console.log(
        `  ${i + 1}. ${m.user.email}: User.name="${m.userName}" vs Agent.name="${m.agentName}"`
      );
    });
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('요약');
  console.log('='.repeat(80));
  console.log(`총 User: ${users.length}명`);
  console.log(`공지 열람 가능: ${okUsers.length}명`);
  console.log(`공지 열람 오류 가능: ${issues.length}명`);
  console.log(`User 없는 활성 Agent: ${activeAgentsWithoutUser.length}명`);
  console.log('='.repeat(80) + '\n');

  if (issues.length > 0) {
    console.log('해결 방법:');
    console.log(
      '  1. 관리자에서 해당 User에 Agent를 연결(userId 설정)하거나,'
    );
    console.log(
      '  2. Agent.name을 User.name과 동일하게 맞추거나,'
    );
    console.log(
      '  3. User.name을 Agent.name과 동일하게 수정하세요.'
    );
    console.log('');
  }
}

module.exports = { checkNoticeReadAgentIds };

if (require.main === module) {
  try {
    checkNoticeReadAgentIds();
  } catch (err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}
