/**
 * DATABASE_URL 이 postgres* 이면 PostgreSQL(동기 Worker 브리지), 아니면 SQLite(better-sqlite3).
 */

function usePostgres() {
  const u = process.env.DATABASE_URL || '';
  return /^postgres/i.test(u);
}

if (usePostgres()) {
  module.exports = require('./db-pg-facade');
} else {
  module.exports = require('./db-sqlite');
}
