/**
 * 에이전트 표시 이름: DB의 name이 잘못됐을 때 이메일 기준으로 보정.
 * (예: 표시는 한글명, 저장은 오타·초성만 된 경우)
 */
const DISPLAY_NAME_BY_EMAIL = {
  'arthur.kim@latisglobal.com': '아서',
};

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function resolveAgentDisplayName(name, email) {
  const key = normalizeEmail(email);
  if (key && Object.prototype.hasOwnProperty.call(DISPLAY_NAME_BY_EMAIL, key)) {
    return DISPLAY_NAME_BY_EMAIL[key];
  }
  return name;
}

/**
 * { id, name, email? } → API용 { id, name } (이메일 기준 표시명 적용)
 */
function publicAgentFields(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: resolveAgentDisplayName(row.name, row.email),
  };
}

module.exports = {
  DISPLAY_NAME_BY_EMAIL,
  resolveAgentDisplayName,
  publicAgentFields,
};
