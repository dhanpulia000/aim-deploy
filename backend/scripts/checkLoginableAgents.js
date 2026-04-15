// 로그인 가능한 에이전트 계정 확인 스크립트

const { prisma } = require('../libs/db');

async function checkLoginableAgents() {
  try {
    console.log('=== 로그인 가능한 에이전트 계정 확인 ===\n');

    // User 테이블에서 모든 사용자 조회
    const users = await prisma.user.findMany({
      include: {
        agents: true // Agent와 연결된 경우 (복수형)
      },
      orderBy: {
        email: 'asc'
      }
    });

    if (users.length === 0) {
      console.log('❌ 로그인 가능한 계정이 없습니다.');
      return;
    }

    console.log(`총 ${users.length}개의 User 계정이 있습니다.\n`);

    // Agent와 연결된 계정
    const agentsWithUser = users.filter(u => u.agents && u.agents.length > 0);
    // Agent와 연결되지 않은 계정
    const usersWithoutAgent = users.filter(u => !u.agents || u.agents.length === 0);

    if (agentsWithUser.length > 0) {
      console.log('✅ 에이전트와 연결된 로그인 가능한 계정:');
      console.log('─'.repeat(80));
      agentsWithUser.forEach((user, index) => {
        user.agents.forEach((agent, agentIndex) => {
          if (agentIndex === 0) {
            console.log(`\n${index + 1}. 이메일: ${user.email}`);
            console.log(`   이름: ${user.name || 'N/A'}`);
            console.log(`   역할: ${user.role || 'N/A'}`);
          }
          console.log(`   에이전트 ${agentIndex + 1}:`);
          console.log(`     - ID: ${agent.id}`);
          console.log(`     - 이름: ${agent.name}`);
          console.log(`     - 상태: ${agent.status}`);
          console.log(`     - 이메일: ${agent.email || 'N/A'}`);
        });
        console.log(`   비밀번호 설정: ${user.password ? '✅ 있음' : '❌ 없음'}`);
      });
    }

    if (usersWithoutAgent.length > 0) {
      console.log('\n\n⚠️  에이전트와 연결되지 않은 User 계정:');
      console.log('─'.repeat(80));
      usersWithoutAgent.forEach((user, index) => {
        console.log(`\n${index + 1}. 이메일: ${user.email}`);
        console.log(`   이름: ${user.name || 'N/A'}`);
        console.log(`   역할: ${user.role || 'N/A'}`);
        console.log(`   비밀번호 설정: ${user.password ? '✅ 있음' : '❌ 없음'}`);
      });
    }

    // Agent는 있지만 User가 없는 경우
    const agentsWithoutUser = await prisma.agent.findMany({
      where: {
        userId: null
      },
      orderBy: {
        name: 'asc'
      }
    });

    if (agentsWithoutUser.length > 0) {
      console.log('\n\n❌ User 계정이 없는 에이전트 (로그인 불가):');
      console.log('─'.repeat(80));
      agentsWithoutUser.forEach((agent, index) => {
        console.log(`\n${index + 1}. 에이전트 ID: ${agent.id}`);
        console.log(`   에이전트 이름: ${agent.name}`);
        console.log(`   이메일: ${agent.email || 'N/A'}`);
        console.log(`   상태: ${agent.status}`);
      });
    }

    console.log('\n\n=== 요약 ===');
    console.log(`✅ 로그인 가능한 에이전트: ${agentsWithUser.length}명`);
    console.log(`⚠️  에이전트 없는 User: ${usersWithoutAgent.length}명`);
    console.log(`❌ User 없는 에이전트: ${agentsWithoutUser.length}명`);

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLoginableAgents();

