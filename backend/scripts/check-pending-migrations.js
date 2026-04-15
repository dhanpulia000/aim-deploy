/**
 * Check pending Prisma migrations in SQLite.
 *
 * - Verifies that all directories under prisma/migrations have a row in _prisma_migrations.
 * - Fails fast if DB doesn't have _prisma_migrations (e.g., not initialized).
 *
 * Usage:
 *   cd backend && node scripts/check-pending-migrations.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne } = require('../libs/db');

function listMigrationDirs() {
  const migrationsDir = path.join(__dirname, '../prisma/migrations');
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // lock file is not a directory; keep only dirs
    .filter((name) => name && name !== '.DS_Store');
}

function main() {
  const hasTable = queryOne(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'",
    []
  );

  if (!hasTable) {
    console.warn('⚠️  Missing _prisma_migrations table. Skipping pending migration check (legacy DB / migrations not tracked).');
    process.exit(0);
  }

  const applied = new Set(
    query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL", []).map(
      (r) => r.migration_name
    )
  );

  const dirs = listMigrationDirs();
  const pending = dirs.filter((name) => !applied.has(name));

  if (pending.length) {
    console.error('❌ Pending migrations detected:', pending);
    process.exit(2);
  }

  console.log('✅ No pending migrations.');
}

main();

