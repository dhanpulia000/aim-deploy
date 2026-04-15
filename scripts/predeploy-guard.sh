#!/usr/bin/env bash
set -euo pipefail

# Pre-deploy guard for AIM.
# Goal: prevent side-effects when shipping features and DB schema changes.
#
# What it does:
# - creates a consistent SQLite backup
# - optional DB quick_check
# - checks pending Prisma migrations
# - runs backend unit tests (if available)
# - builds frontend + backend smoke checks
#
# Usage:
#   cd AIM
#   bash scripts/predeploy-guard.sh
#
# Env:
#   SQLITE_STARTUP_QUICK_CHECK=true|false  (default: false for this script)
#   SKIP_TESTS=1                          (skip backend tests)
#   SKIP_BUILD=1                          (skip frontend build)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

echo "== Predeploy guard =="
date

echo ""
echo "[1/6] SQLite safe backup"
node "$BACKEND_DIR/scripts/sqlite-safe-backup.js"

echo ""
echo "[2/6] SQLite quick_check (optional)"
if [[ "${SQLITE_STARTUP_QUICK_CHECK:-false}" == "1" || "${SQLITE_STARTUP_QUICK_CHECK:-false}" == "true" ]]; then
  node - <<'NODE'
const { getDatabase } = require('./backend/libs/db');
const db = getDatabase();
const rows = db.pragma('quick_check');
const failed = rows.filter((r) => String(r.quick_check ?? Object.values(r)[0]).toLowerCase() !== 'ok');
if (failed.length) {
  console.error('quick_check failed:', failed);
  process.exit(1);
}
console.log('quick_check ok');
NODE
else
  echo "SKIP (set SQLITE_STARTUP_QUICK_CHECK=true to enable)"
fi

echo ""
echo "[3/6] Pending migrations check"
node "$BACKEND_DIR/scripts/check-pending-migrations.js"

echo ""
echo "[4/6] Backend tests"
if [[ "${SKIP_TESTS:-0}" == "1" ]]; then
  echo "SKIP (SKIP_TESTS=1)"
else
  (cd "$BACKEND_DIR" && npm test)
fi

echo ""
echo "[5/6] Frontend build"
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "SKIP (SKIP_BUILD=1)"
else
  (cd "$ROOT_DIR" && npm run build)
fi

echo ""
echo "[6/6] Backend smoke checks"
node "$BACKEND_DIR/scripts/smoke-check.js"

echo ""
echo "✅ Predeploy guard PASSED"

