/**
 * 소스 SQLite에만 있는 행을 타깃 DB에 삽입 (FK 순서 위상 정렬).
 *
 * node scripts/merge-sqlite-from-source.js --source <path> --target <path> [--dry-run]
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function parseArgs() {
  const args = process.argv.slice(2);
  const o = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') o.source = args[++i];
    else if (args[i] === '--target') o.target = args[++i];
    else if (args[i] === '--dry-run') o.dryRun = true;
  }
  if (!o.source || !o.target) {
    console.error(
      'Usage: node merge-sqlite-from-source.js --source <file> --target <file> [--dry-run]'
    );
    process.exit(1);
  }
  return o;
}

function tableNames(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map((r) => r.name);
}

function pkColumns(db, table) {
  const esc = table.replace(/"/g, '""');
  return db
    .prepare(`PRAGMA table_info("${esc}")`)
    .all()
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

function commonColumns(sourceDb, targetDb, table) {
  const esc = table.replace(/"/g, '""');
  const s = sourceDb.prepare(`PRAGMA table_info("${esc}")`).all().map((c) => c.name);
  const tSet = new Set(
    targetDb.prepare(`PRAGMA table_info("${esc}")`).all().map((c) => c.name)
  );
  return s.filter((c) => tSet.has(c));
}

function topologicalTableOrder(db, names) {
  const set = new Set(names);
  const deps = new Map();
  for (const t of names) {
    deps.set(t, new Set());
    const esc = t.replace(/"/g, '""');
    const fks = db.prepare(`PRAGMA foreign_key_list("${esc}")`).all();
    for (const fk of fks) {
      if (fk.table && set.has(fk.table)) {
        deps.get(t).add(fk.table);
      }
    }
  }
  const result = [];
  const all = [...names];
  while (result.length < all.length) {
    const remaining = all.filter((t) => !result.includes(t));
    const ready = remaining.filter((t) =>
      [...deps.get(t)].every((d) => result.includes(d))
    );
    if (ready.length === 0) {
      remaining.sort((a, b) => a.localeCompare(b));
      result.push(...remaining);
      break;
    }
    ready.sort((a, b) => a.localeCompare(b));
    for (const t of ready) {
      if (!result.includes(t)) result.push(t);
    }
  }
  return result;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function countAndMaybeInsert(sourceDb, targetDb, table, dryRun) {
  const cols = commonColumns(sourceDb, targetDb, table);
  if (cols.length === 0) {
    return { table, skipped: true, reason: 'no common columns' };
  }
  const pks = pkColumns(sourceDb, table);
  if (pks.length === 0) {
    return { table, skipped: true, reason: 'no primary key in source' };
  }
  for (const pk of pks) {
    if (!cols.includes(pk)) {
      return { table, skipped: true, reason: `pk ${pk} not in common columns` };
    }
  }

  const tq = quoteIdent(table);
  const colList = cols.map(quoteIdent).join(', ');
  const notExists = pks
    .map((pk) => `t.${quoteIdent(pk)} = s.${quoteIdent(pk)}`)
    .join(' AND ');

  /** RawLog: UNIQUE(boardId, articleId) — id만으로는 부족 */
  const rawLogExtraFilter =
    table === 'RawLog' &&
    cols.includes('boardId') &&
    cols.includes('articleId')
      ? `AND (
  s.boardId IS NULL OR s.articleId IS NULL OR TRIM(COALESCE(CAST(s.articleId AS TEXT), '')) = ''
  OR NOT EXISTS (
    SELECT 1 FROM main.${tq} t2
    WHERE (t2.boardId = s.boardId OR (t2.boardId IS NULL AND s.boardId IS NULL))
    AND ((t2.articleId = s.articleId) OR (t2.articleId IS NULL AND s.articleId IS NULL))
  )
)`
      : '';

  const countSql = `
    SELECT COUNT(*) AS c FROM src.${tq} s
    WHERE NOT EXISTS (SELECT 1 FROM main.${tq} t WHERE ${notExists})
    ${rawLogExtraFilter}
  `;
  const toInsert = targetDb.prepare(countSql).get().c;

  if (dryRun || toInsert === 0) {
    return { table, toInsert, inserted: 0 };
  }

  const insertSql = `
    INSERT INTO main.${tq} (${colList})
    SELECT ${colList} FROM src.${tq} s
    WHERE NOT EXISTS (SELECT 1 FROM main.${tq} t WHERE ${notExists})
    ${rawLogExtraFilter}
  `;
  const info = targetDb.prepare(insertSql).run();
  return { table, toInsert, inserted: info.changes };
}

function refreshSqliteSequence(targetDb) {
  const tables = targetDb
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%AUTOINCREMENT%'`
    )
    .all()
    .map((r) => r.name);
  for (const table of tables) {
    const pk = pkColumns(targetDb, table);
    if (pk.length === 1) {
      const row = targetDb
        .prepare(`SELECT MAX(${quoteIdent(pk[0])}) AS m FROM ${quoteIdent(table)}`)
        .get();
      const m = row && row.m != null ? Number(row.m) : 0;
      if (m > 0) {
        targetDb
          .prepare(`INSERT OR REPLACE INTO sqlite_sequence(name,seq) VALUES (?,?)`)
          .run(table, m);
      }
    }
  }
}

function main() {
  const { source, target, dryRun } = parseArgs();
  const absSource = path.resolve(source);
  const absTarget = path.resolve(target);
  if (!fs.existsSync(absSource)) {
    console.error('Source not found:', absSource);
    process.exit(1);
  }
  if (!fs.existsSync(absTarget)) {
    console.error('Target not found:', absTarget);
    process.exit(1);
  }

  const sourceDb = new Database(absSource, { readonly: true });
  const targetDb = new Database(absTarget);

  const srcTables = new Set(tableNames(sourceDb));
  const tgtTables = tableNames(targetDb).filter((t) => srcTables.has(t));
  const order = topologicalTableOrder(sourceDb, tgtTables);

  const attachPath = absSource.replace(/'/g, "''");
  targetDb.exec(`ATTACH DATABASE '${attachPath}' AS src`);
  targetDb.pragma('foreign_keys = OFF');

  const report = [];
  let totalToInsert = 0;
  let totalInserted = 0;
  for (const table of order) {
    try {
      const r = countAndMaybeInsert(sourceDb, targetDb, table, dryRun);
      report.push(r);
      if (r.toInsert) totalToInsert += r.toInsert;
      if (r.inserted) totalInserted += r.inserted;
    } catch (e) {
      report.push({ table, error: e.message });
    }
  }

  if (!dryRun) {
    try {
      refreshSqliteSequence(targetDb);
    } catch (e) {
      report.push({ step: 'sqlite_sequence', error: e.message });
    }
  }

  targetDb.prepare('DETACH DATABASE src').run();
  targetDb.close();
  sourceDb.close();

  const out = {
    dryRun,
    source: absSource,
    target: absTarget,
    totalToInsert,
    totalInserted: dryRun ? 0 : totalInserted,
    tables: report,
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
