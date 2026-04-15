/**
 * SQLite 온라인 백업 (sqlite_backup API). 단일 통합 .db 파일 생성(-wal 내용 포함).
 * 실행: cd backend && node scripts/sqlite-safe-backup.js
 * 선택: OUT=/path/to/backup.db node scripts/sqlite-safe-backup.js
 * 덮어쓰기(안전): OUT을 고정 경로로 지정하면, 임시 파일로 백업 후 원자적으로 교체합니다.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function resolveDbPath() {
  let u = process.env.DATABASE_URL || 'file:./prisma/dev.db';
  if (u.startsWith('file:')) u = u.replace(/^file:/, '');
  if (!path.isAbsolute(u)) u = path.resolve(__dirname, '..', u);
  return u;
}

function safeUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    // ignore
  }
}

async function main() {
  const src = resolveDbPath();
  if (!fs.existsSync(src)) {
    console.error('Source DB not found:', src);
    process.exit(1);
  }

  let dest = process.env.OUT;
  if (!dest) {
    const backupsDir = path.join(path.dirname(src), 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    dest = path.join(backupsDir, `dev-${stamp}.db`);
  } else if (!path.isAbsolute(dest)) {
    dest = path.resolve(process.cwd(), dest);
  }

  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });

  const lockPath = `${dest}.lock`;
  const tmpPath = `${dest}.tmp-${process.pid}-${Date.now()}`;
  let lockFd = null;

  const cleanup = () => {
    if (lockFd != null) {
      try {
        fs.closeSync(lockFd);
      } catch (e) {
        // ignore
      }
      lockFd = null;
    }
    safeUnlink(lockPath);
    safeUnlink(tmpPath);
  };

  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    // 동시 실행 방지(예: cron/pm2가 겹쳐 실행되는 경우)
    lockFd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(lockFd, String(process.pid));
  } catch (e) {
    console.error('Backup lock exists. Another backup may be running.', { lockPath });
    process.exit(2);
  }

  const db = new Database(src, { readonly: true, timeout: 60000 });
  try {
    // 먼저 임시 파일로 백업(실패해도 기존 dest는 보존)
    await db.backup(tmpPath);

    // 같은 디렉토리 내 rename은 원자적으로 교체됨(대부분의 POSIX FS)
    fs.renameSync(tmpPath, dest);
    console.log('Backup OK:', dest);
  } finally {
    db.close();
    cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
