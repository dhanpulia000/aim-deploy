// 에이전트 계정 비밀번호 재설정 스크립트
// 사용법: node reset-password.js <email> <new-password>

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.log('❌ 사용법: node reset-password.js <email> <new-password>');
    console.log('\n예시:');
    console.log('  node reset-password.js agent@example.com newpassword123');
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.log('❌ 비밀번호는 최소 6자 이상이어야 합니다.');
    process.exit(1);
  }

  try {
    // 사용자 찾기
    const user = await prisma.user.findUnique({
      where: { email: email },
      include: {
        agents: true
      }
    });

    if (!user) {
      console.log(`❌ 이메일 "${email}"에 해당하는 사용자를 찾을 수 없습니다.`);
      process.exit(1);
    }

    // 비밀번호 해시
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 비밀번호 업데이트
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    console.log('✅ 비밀번호가 성공적으로 변경되었습니다!');
    console.log('\n사용자 정보:');
    console.log(`  이메일: ${user.email}`);
    console.log(`  이름: ${user.name || 'N/A'}`);
    console.log(`  역할: ${user.role}`);
    if (user.agents && user.agents.length > 0) {
      console.log(`  연결된 에이전트: ${user.agents.map(a => a.name).join(', ')}`);
    }
    console.log(`\n새 비밀번호: ${newPassword}`);
    console.log('\n⚠️  이 비밀번호를 안전하게 보관하세요.');

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword();









