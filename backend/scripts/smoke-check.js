/**
 * Minimal smoke checks for backend critical endpoints.
 *
 * Usage:
 *   cd backend && node scripts/smoke-check.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:9080';
// NOTE: ISSUE_WATCH_INTERNAL_TOKEN is NOT a JWT for API auth.
// Use SMOKE_JWT if you need to hit authenticated endpoints.
const SMOKE_JWT = process.env.SMOKE_JWT || '';

async function mustFetch(pathname) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: SMOKE_JWT ? { Authorization: `Bearer ${SMOKE_JWT}` } : undefined,
    cache: 'no-store'
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${pathname} -> ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  return res;
}

async function main() {
  const checks = [
    '/api/issues?limit=1&offset=0',
    '/api/issues/game-counts',
    '/api/issues/clan?limit=1'
  ];

  for (const c of checks) {
    // eslint-disable-next-line no-console
    console.log('GET', c);
    await mustFetch(c);
  }

  // Optional authenticated endpoint
  if (SMOKE_JWT) {
    // eslint-disable-next-line no-console
    console.log('GET /api/monitoring/status (auth)');
    await mustFetch('/api/monitoring/status');
  }

  // eslint-disable-next-line no-console
  console.log('✅ Smoke checks OK');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('❌ Smoke checks failed:', e.message);
  process.exit(1);
});

