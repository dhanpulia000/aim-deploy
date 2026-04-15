// 에이전트 계정 비밀번호 재설정 스크립트 (better-sqlite3 버전)
// 사용법: node reset-password-sqlite.js <email> <new-password>

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.log('❌ 사용법: node reset-password-sqlite.js <email> <new-password>');
    console.log('\n예시:');
    console.log('  node reset-password-sqlite.js agent@example.com newpassword123');
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.log('❌ 비밀번호는 최소 6자 이상이어야 합니다.');
    process.exit(1);
  }

  try {
    // 사용자 찾기
    const user = queryOne('SELECT * FROM User WHERE email = ?', [email]);

    if (!user) {
      console.log(`❌ 이메일 "${email}"에 해당하는 사용자를 찾을 수 없습니다.`);
      process.exit(1);
    }

    // 연결된 에이전트 확인
    const agent = queryOne('SELECT * FROM Agent WHERE userId = ?', [user.id]);

    // 비밀번호 해시
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 비밀번호 업데이트
    execute(
      'UPDATE User SET password = ?, updatedAt = ? WHERE id = ?',
      [hashedPassword, new Date().toISOString(), user.id]
    );

    console.log('✅ 비밀번호가 성공적으로 변경되었습니다!');
    console.log('\n사용자 정보:');
    console.log(`  이메일: ${user.email}`);
    console.log(`  이름: ${user.name || 'N/A'}`);
    console.log(`  역할: ${user.role}`);
    if (agent) {
      console.log(`  연결된 에이전트: ${agent.name}`);
    }
    console.log(`\n새 비밀번호: ${newPassword}`);
    console.log('\n⚠️  이 비밀번호를 안전하게 보관하세요.');

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    console.error(error.stack);
    logger.error('[ResetPassword] Error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

resetPassword().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ 스크립트 실행 실패:', error);
  process.exit(1);
});











