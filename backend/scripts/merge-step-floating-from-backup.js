/**
 * StepFloating 행을 백업 SQLite에서 현재 dev.db로 병합합니다.
 * 사용: node scripts/merge-step-floating-from-backup.js [백업파일경로]
 * 기본: prisma/dev.db.corrupt-20260324-002941
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../libs/db');

const defaultBackup = path.join(__dirname, '../prisma/dev.db.corrupt-20260324-002941');
const backupPath = path.resolve(process.argv[2] || defaultBackup);

if (!fs.existsSync(backupPath)) {
  console.error('백업 파일이 없습니다:', backupPath);
  process.exit(1);
}

function main() {
  try {
    runMerge();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

function runMerge() {
  const db = getDatabase();
  const alias = 'sfbak';
  const escaped = backupPath.replace(/'/g, "''");

  const cols = db
    .prepare('PRAGMA table_info(StepFloating)')
    .all()
    .sort((a, b) => a.cid - b.cid)
    .map((c) => c.name);

  db.exec(`ATTACH DATABASE '${escaped}' AS ${alias}`);

  const toMerge = db
    .prepare(
      `SELECT ${cols.map((c) => `m.${c} AS "${c}"`).join(', ')}
       FROM ${alias}.StepFloating m
       WHERE m.id NOT IN (SELECT id FROM StepFloating)`
    )
    .all();

  console.log('병합 대상 스텝 플로팅:', toMerge.length, '건');

  const insert = db.prepare(
    `INSERT INTO StepFloating (${cols.join(', ')})
     VALUES (${cols.map(() => '?').join(', ')})`
  );

  const tx = db.transaction(() => {
    for (const row of toMerge) {
      const vals = cols.map((c) => row[c]);
      insert.run(...vals);
    }
  });

  tx();
  db.exec(`DETACH DATABASE ${alias}`);
  console.log(
    '완료. StepFloating 총',
    db.prepare('SELECT COUNT(*) as c FROM StepFloating').get().c,
    '건'
  );
}

main();
