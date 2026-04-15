/**
 * CustomerFeedbackNotice / CustomerFeedbackNoticeRead 를 백업 SQLite에서 현재 dev.db로 병합합니다.
 * 사용: node scripts/merge-customer-feedback-notices-from-backup.js [백업파일경로]
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
  const alias = 'noticebak';
  const escaped = backupPath.replace(/'/g, "''");

  const noticeCols = db
    .prepare('PRAGMA table_info(CustomerFeedbackNotice)')
    .all()
    .sort((a, b) => a.cid - b.cid)
    .map((c) => c.name);

  const readCols = db
    .prepare('PRAGMA table_info(CustomerFeedbackNoticeRead)')
    .all()
    .sort((a, b) => a.cid - b.cid)
    .map((c) => c.name);

  db.exec(`ATTACH DATABASE '${escaped}' AS ${alias}`);

  const toMerge = db
    .prepare(
      `SELECT ${noticeCols.map((c) => `m.${c} AS "${c}"`).join(', ')}
       FROM ${alias}.CustomerFeedbackNotice m
       WHERE m.id NOT IN (SELECT id FROM CustomerFeedbackNotice)`
    )
    .all();

  console.log('병합 대상 공지:', toMerge.length, '건');

  const insertNotice = db.prepare(
    `INSERT INTO CustomerFeedbackNotice (${noticeCols.join(', ')})
     VALUES (${noticeCols.map(() => '?').join(', ')})`
  );

  const insertRead = db.prepare(
    `INSERT OR IGNORE INTO CustomerFeedbackNoticeRead (${readCols.join(', ')})
     VALUES (${readCols.map(() => '?').join(', ')})`
  );

  const tx = db.transaction(() => {
    for (const row of toMerge) {
      const vals = noticeCols.map((c) => row[c]);
      insertNotice.run(...vals);
    }

    const readRows = db
      .prepare(`SELECT r.* FROM ${alias}.CustomerFeedbackNoticeRead r`)
      .all();

    let readInserted = 0;
    const noticeExists = db.prepare('SELECT 1 FROM CustomerFeedbackNotice WHERE id = ?');
    const agentExists = db.prepare('SELECT 1 FROM Agent WHERE id = ?');

    for (const r of readRows) {
      if (!noticeExists.get(r.noticeId)) continue;
      if (r.agentId != null && !agentExists.get(r.agentId)) continue;
      const vals = readCols.map((c) => r[c]);
      const info = insertRead.run(...vals);
      if (info.changes > 0) readInserted += 1;
    }
    console.log('추가된 열람 기록 행:', readInserted, '건 (INSERT OR IGNORE)');
  });

  tx();
  db.exec(`DETACH DATABASE ${alias}`);
  console.log(
    '완료. CustomerFeedbackNotice 총',
    db.prepare('SELECT COUNT(*) as c FROM CustomerFeedbackNotice').get().c,
    '건'
  );
}

main();
