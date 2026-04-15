/**
 * Tiny helper to verify Postgres schema without psql.
 *
 * Usage:
 *   cd backend
 *   node scripts/check-reportitemissue-columns.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is missing');
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  const cols = ['discourseViews', 'discourseLikeCount', 'discourseReplyCount'];
  const res = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='ReportItemIssue'
      AND column_name = ANY($1::text[])
    ORDER BY column_name;
  `,
    [cols]
  );

  // Avoid printing password in logs (best-effort masking)
  const masked = url.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/i, '$1****@');
  console.log('DATABASE_URL', masked);
  console.log('found_columns', res.rows.map((r) => r.column_name));

  await client.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});

