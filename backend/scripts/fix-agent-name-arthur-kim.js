/**
 * arthur.kim@latisglobal.com 계정의 Agent/User 표시명을 DB에 '아서'로 맞춤.
 * (API 오버라이드와 함께 쓰면 레포트·로그 등 DB raw name도 일치합니다.)
 *
 * 사용: node backend/scripts/fix-agent-name-arthur-kim.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { execute, queryOne } = require('../libs/db');

const EMAIL = 'arthur.kim@latisglobal.com';
const NAME = '아서';
const emailKey = EMAIL.trim().toLowerCase();

const agent = queryOne(
  'SELECT id, name FROM Agent WHERE LOWER(TRIM(email)) = ?',
  [emailKey]
);
if (agent) {
  execute('UPDATE Agent SET name = ?, updatedAt = ? WHERE id = ?', [
    NAME,
    new Date().toISOString(),
    agent.id,
  ]);
  console.log(`[OK] Agent ${agent.id}: name "${agent.name}" -> "${NAME}"`);
} else {
  console.log('[SKIP] No Agent row for email', EMAIL);
}

const user = queryOne(
  'SELECT id, name FROM User WHERE LOWER(TRIM(email)) = ?',
  [emailKey]
);
if (user) {
  execute('UPDATE User SET name = ?, updatedAt = ? WHERE id = ?', [
    NAME,
    new Date().toISOString(),
    user.id,
  ]);
  console.log(`[OK] User ${user.id}: name "${user.name}" -> "${NAME}"`);
} else {
  console.log('[SKIP] No User row for email', EMAIL);
}
