/**
 * 클랜 중복 홍보(duplicate_promotion) 검출 — issues.service.checkDuplicateClanPromotions 와 동일 로직
 * 실행: cd backend && node scripts/check-clan-duplicate-promotion.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../libs/db');
const { checkDuplicateClanPromotions } = require('../services/issues.service');

const sql = `SELECT i.id, i.summary, i.detail, i.date, i.createdAt, i.sourceCreatedAt, i.sourceUrl, i.externalPostId
FROM ReportItemIssue i
WHERE 1=1
  AND (
    i.summary LIKE '🏰┃클랜/방송/디스코드%'
    OR i.summary LIKE '%클랜 홍보%'
    OR i.summary LIKE '%클랜홍보%'
    OR i.summary LIKE '%클랜/방송/디스코드%'
    OR i.detail LIKE '%클랜/방송/디스코드%'
    OR i.detail LIKE '%클랜 홍보%'
    OR i.detail LIKE '%클랜홍보%'
    OR i.summary LIKE '%클랜%'
    OR i.detail LIKE '%클랜%'
  )
ORDER BY i.date DESC, i.createdAt DESC`;

(async () => {
  const issues = query(sql, []);
  console.log(`\n[클랜 이슈] 총 ${issues.length}건 조회\n`);

  if (issues.length === 0) {
    console.log('클랜 이슈가 없어 검출 여부를 확인할 수 없습니다.');
    process.exit(0);
  }

  const alerts = await checkDuplicateClanPromotions(issues);
  const uniqueByIssue = new Map();
  alerts.forEach((a) => {
    if (!uniqueByIssue.has(a.issueId)) uniqueByIssue.set(a.issueId, a);
  });

  if (uniqueByIssue.size === 0) {
    console.log('✅ 중복 홍보(duplicate_promotion) 검출된 사례: 없음');
    console.log('\n- 같은 원글 일자(KST)·정규화 제목 동일·서로 다른 externalPostId 2건 이상일 때 검출됩니다.');
  } else {
    console.log(`⚠️ 중복 홍보(duplicate_promotion) 검출된 사례: ${uniqueByIssue.size}건`);
    uniqueByIssue.forEach((a, id) => {
      console.log(`\n  - 이슈 ID: ${id}`);
      console.log(`    메시지: ${a.message}`);
    });
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
