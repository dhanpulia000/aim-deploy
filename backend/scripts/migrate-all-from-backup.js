/**
 * 백업 SQLite → 현재 dev.db 전 테이블 병합 (INSERT OR IGNORE)
 *
 * 사용:
 *   node scripts/migrate-all-from-backup.js [--dry-run] [--backup PATH] [--no-snapshot]
 *
 * - PK·UNIQUE 충돌 시 기존 행 유지 (RawLog boardId+articleId 등)
 * - 기본 백업: prisma/dev.db.corrupt-20260324-002941
 * - 실행 전 현재 DB를 prisma/dev.db.pre-migrate-<timestamp>.bak 로 복사 (--no-snapshot 제외)
 * - _migrations / sqlite_sequence 는 건너뜀
 * - dry-run 의 건수는 PK 기준 NOT EXISTS (UNIQUE만 겹치는 경우 실제 INSERT 건수와 다를 수 있음)
 *
 * 실무: 백엔드·워커 중지 후 실행 권장.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noSnapshot = args.includes('--no-snapshot');
const backupArg = args.find((a) => a.startsWith('--backup='));
const backupPath = path.resolve(
  backupArg ? backupArg.split('=')[1] : path.join(__dirname, '../prisma/dev.db.corrupt-20260324-002941')
);

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function resolveMainDbPath() {
  let dbPath = process.env.DATABASE_URL || 'file:./prisma/dev.db';
  if (dbPath.startsWith('file:')) dbPath = dbPath.replace(/^file:/, '');
  if (!path.isAbsolute(dbPath)) dbPath = path.resolve(__dirname, '..', dbPath);
  return dbPath;
}

function getTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map((r) => r.name);
}

function tableExists(db, name) {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

function getColumnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name);
}

function getPkColumnNames(db, table) {
  return db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all()
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

function buildDeps(db, tables) {
  const deps = {};
  for (const t of tables) {
    deps[t] = [];
    try {
      const fks = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(t)})`).all();
      for (const fk of fks) {
        if (fk.table && tables.includes(fk.table) && !deps[t].includes(fk.table)) {
          deps[t].push(fk.table);
        }
      }
    } catch {
      deps[t] = [];
    }
  }
  return deps;
}

function topologicalSort(tables, deps) {
  const sorted = [];
  const vis = new Set();
  function visit(t) {
    if (vis.has(t)) return;
    for (const d of deps[t] || []) {
      if (tables.includes(d)) visit(d);
    }
    vis.add(t);
    sorted.push(t);
  }
  for (const t of tables) visit(t);
  return sorted;
}

function commonColumns(mainCols, bakCols) {
  const b = new Set(bakCols);
  return mainCols.filter((c) => b.has(c));
}

function main() {
  if (!fs.existsSync(backupPath)) {
    console.error('백업 파일이 없습니다:', backupPath);
    process.exit(1);
  }

  const mainPath = resolveMainDbPath();
  if (!fs.existsSync(mainPath)) {
    console.error('현재 DB가 없습니다:', mainPath);
    process.exit(1);
  }

  const snapshotPath = path.join(
    path.dirname(mainPath),
    `dev.db.pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  );

  if (!dryRun && !noSnapshot) {
    fs.copyFileSync(mainPath, snapshotPath);
    console.log('스냅샷 저장:', snapshotPath);
  }

  const mainDb = new Database(mainPath, { timeout: 120000 });
  const bakDb = new Database(backupPath, { readonly: true });

  mainDb.pragma('foreign_keys = OFF');
  mainDb.pragma('journal_mode = WAL');

  const alias = 'bak';
  const escaped = backupPath.replace(/'/g, "''");
  mainDb.exec(`ATTACH DATABASE '${escaped}' AS ${alias}`);

  const mainAllTables = getTables(mainDb);
  const mainTables = mainAllTables.filter((t) => t !== '_migrations' && t !== 'sqlite_sequence');
  const bakTables = new Set(getTables(bakDb));
  const deps = buildDeps(mainDb, getTables(mainDb));
  const order = topologicalSort(mainTables, deps);

  const skipOnlyBackup = [];
  const results = [];
  const mergeable = [];

  for (const table of order) {
    if (table === '_migrations' || table === 'sqlite_sequence') continue;
    if (!tableExists(bakDb, table)) {
      results.push({ table, reason: '백업에 테이블 없음' });
      continue;
    }

    const mainCols = getColumnNames(mainDb, table);
    const bakCols = getColumnNames(bakDb, table);
    const cols = commonColumns(mainCols, bakCols);
    if (!cols.length) {
      results.push({ table, reason: '공통 컬럼 없음' });
      continue;
    }

    const pk = getPkColumnNames(mainDb, table);
    if (!pk.length) {
      results.push({ table, reason: 'PK 없음' });
      continue;
    }

    const colList = cols.map(quoteIdent).join(', ');
    const notExists =
      pk.length === 1
        ? `NOT EXISTS (SELECT 1 FROM main.${quoteIdent(table)} m WHERE m.${quoteIdent(pk[0])} = s.${quoteIdent(pk[0])})`
        : `NOT EXISTS (SELECT 1 FROM main.${quoteIdent(table)} m WHERE ${pk
            .map((c) => `m.${quoteIdent(c)} = s.${quoteIdent(c)}`)
            .join(' AND ')})`;

    const countSql = `
      SELECT COUNT(*) AS c FROM ${alias}.${quoteIdent(table)} s
      WHERE ${notExists}`;
    const count = mainDb.prepare(countSql).get().c;

    if (dryRun) {
      results.push({ table, inserted: count, dryRun: true });
      continue;
    }

    mergeable.push({ table, colList, cols });
  }

  if (!dryRun) {
    const runAll = mainDb.transaction(() => {
      for (const m of mergeable) {
        const insertSql = `
          INSERT OR IGNORE INTO main.${quoteIdent(m.table)} (${m.colList})
          SELECT ${m.cols.map((c) => `s.${quoteIdent(c)}`).join(', ')}
          FROM ${alias}.${quoteIdent(m.table)} s`;
        const info = mainDb.prepare(insertSql).run();
        results.push({ table: m.table, inserted: info.changes });
      }
    });
    runAll();
  }

  const mainSet = new Set(mainAllTables);
  for (const t of bakTables) {
    if (!mainSet.has(t) && t !== 'sqlite_sequence') {
      skipOnlyBackup.push(t);
    }
  }

  mainDb.exec(`DETACH DATABASE ${alias}`);
  mainDb.pragma('foreign_keys = ON');

  const integrity = mainDb.prepare('PRAGMA integrity_check').get();
  mainDb.close();
  bakDb.close();

  console.log('\n=== 병합 요약 (백업에만 있던 행 INSERT) ===');
  console.table(
    results.map((r) => ({
      table: r.table,
      inserted: typeof r.inserted === 'number' ? r.inserted : r.reason || '-',
      note: r.dryRun ? '(dry-run, PK기준)' : r.reason || '',
    }))
  );

  if (skipOnlyBackup.length) {
    console.log('\n백업에만 있어 건너뜀 (현재 스키마에 없음):', skipOnlyBackup.join(', '));
  }

  console.log('\nPRAGMA integrity_check:', integrity.integrity_check || integrity);

  if (dryRun) {
    console.log('\n실제 반영: node scripts/migrate-all-from-backup.js ( --dry-run 제거 )');
  }
}

main();
