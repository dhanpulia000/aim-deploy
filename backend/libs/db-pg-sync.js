const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

let child;
let seq = 1;
/** readSync 로 읽은 stdout 에 남은 바이트 (한 번에 여러 줄이 올 때) */
let stdoutRemainder = '';

function terminateChild(reason) {
  if (!child) return;
  try {
    logger.warn('[db-pg-sync] Terminating PostgreSQL child process', { reason: reason || 'unknown' });
    stdoutRemainder = '';
    try {
      child.stdin.end();
    } catch (_) {
      /* ignore */
    }
    child.kill('SIGTERM');
  } catch (e) {
    logger.warn('[db-pg-sync] child.kill failed', { error: e.message });
  }
  child = null;
}

function getChild() {
  if (!child) {
    stdoutRemainder = '';
    const childPath = path.join(__dirname, 'db-pg-sync-child.js');
    child = spawn(process.execPath, [childPath], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..')
    });

    child.on('error', (err) => {
      logger.error('[db-pg-sync] child error', { error: err.message });
      child = null;
    });

    child.on('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') {
        child = null;
        return;
      }
      logger.error('[db-pg-sync] child exited unexpectedly', { code, signal });
      child = null;
    });
  }
  return child;
}

/**
 * stdout 에서 한 줄(JSON) 동기 읽기 — 메인 이벤트 루프를 쓰지 않음 (Atomics.wait 교착 회피)
 */
function stdoutFd(c) {
  if (typeof c.stdout.fd === 'number') return c.stdout.fd;
  if (c.stdout._handle && typeof c.stdout._handle.fd === 'number') return c.stdout._handle.fd;
  return null;
}

function readResponseLine(c, timeoutMs) {
  const fd = stdoutFd(c);
  if (fd == null) {
    throw new Error('pg child stdout has no fd');
  }
  const buf = Buffer.alloc(65536);
  const deadline = Date.now() + timeoutMs;
  while (!stdoutRemainder.includes('\n')) {
    if (Date.now() > deadline) {
      throw new Error(`pg sync read timeout after ${timeoutMs}ms`);
    }
    let n;
    try {
      n = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN' || e.code === 'EINTR') continue;
      throw e;
    }
    if (n === 0) {
      throw new Error('pg child stdout closed (EOF)');
    }
    stdoutRemainder += buf.slice(0, n).toString('utf8');
  }
  const idx = stdoutRemainder.indexOf('\n');
  const line = stdoutRemainder.slice(0, idx);
  stdoutRemainder = stdoutRemainder.slice(idx + 1);
  return JSON.parse(line);
}

function callSync(op, payload) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !/^postgres/i.test(connectionString)) {
    throw new Error('DATABASE_URL must be a postgres:// connection string');
  }

  const c = getChild();
  const id = seq++;
  const timeoutMs = Number(process.env.PG_SYNC_TIMEOUT_MS) || 20000;
  const line = JSON.stringify({ seq: id, op, ...payload });
  if (!c.stdin.write(`${line}\n`)) {
    throw new Error('pg child stdin backlog (payload too large)');
  }

  let msg;
  try {
    msg = readResponseLine(c, timeoutMs);
  } catch (e) {
    terminateChild(`read fail: ${e.message}`);
    throw new Error(`pg sync timeout after ${timeoutMs}ms (op=${op})`);
  }

  if (msg.seq !== id) {
    terminateChild('seq mismatch');
    throw new Error('pg child response seq mismatch');
  }

  if (!msg.ok) {
    throw new Error(msg.error || 'pg child error');
  }

  return {
    rows: msg.rows,
    row: msg.row,
    rowCount: msg.rowCount,
    lastId: msg.lastId
  };
}

function ping() {
  return callSync('ping', {});
}

function query(sql, params) {
  return callSync('query', { sql, params }).rows;
}

function queryOne(sql, params) {
  return callSync('get', { sql, params }).row;
}

function run(sql, params) {
  const r = callSync('run', { sql, params });
  return {
    lastInsertRowid: r.lastId,
    changes: r.rowCount
  };
}

function begin() {
  callSync('begin', {});
}

function commit() {
  callSync('commit', {});
}

function rollback() {
  callSync('rollback', {});
}

function closePool() {
  if (!child) return;
  try {
    const c = child;
    const line = JSON.stringify({ seq: seq++, op: 'close' });
    c.stdin.write(`${line}\n`);
    readResponseLine(c, 5000);
  } catch (_) {
    /* ignore */
  }
  terminateChild('closePool');
}

module.exports = {
  ping,
  query,
  queryOne,
  run,
  begin,
  commit,
  rollback,
  closePool
};
