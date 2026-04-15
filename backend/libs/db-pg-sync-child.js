/**
 * PostgreSQL 동기 브리지용 자식 프로세스.
 * 부모는 stdin/stdout 으로 NDJSON 한 줄 요청·응답 (메인 스레드 Atomics.wait 와 IPC 가 교착이라 IPC 미사용).
 */
const readline = require('readline');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString || !/^postgres/i.test(connectionString)) {
  process.stderr.write('[db-pg-sync-child] DATABASE_URL missing or not postgres\n');
  process.exit(1);
}

const connMs = Number(process.env.PG_CONNECTION_TIMEOUT_MS);
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: Number.isFinite(connMs) && connMs > 0 ? connMs : 10000
});

let txClient = null;

function sendLine(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line || !line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    sendLine({ seq: null, ok: false, error: `invalid json: ${e.message}` });
    return;
  }
  const { seq, op, sql, params } = msg;

  const reply = (payload) => sendLine({ seq, ...payload });

  try {
    const client = txClient || pool;

    switch (op) {
      case 'ping':
        await pool.query('SELECT 1');
        reply({ ok: true });
        break;
      case 'query': {
        const r = await client.query(sql, params || []);
        reply({ ok: true, rows: r.rows });
        break;
      }
      case 'get': {
        const r = await client.query(sql, params || []);
        reply({ ok: true, row: r.rows[0] || null });
        break;
      }
      case 'run': {
        const r = await client.query(sql, params || []);
        const id = r.rows[0] && (r.rows[0].id ?? r.rows[0].Id);
        reply({ ok: true, rowCount: r.rowCount, lastId: id != null ? id : null });
        break;
      }
      case 'begin':
        if (txClient) throw new Error('nested transaction not supported');
        txClient = await pool.connect();
        await txClient.query('BEGIN');
        reply({ ok: true });
        break;
      case 'commit':
        if (!txClient) {
          reply({ ok: true });
          break;
        }
        try {
          await txClient.query('COMMIT');
        } finally {
          txClient.release();
          txClient = null;
        }
        reply({ ok: true });
        break;
      case 'rollback':
        if (!txClient) {
          reply({ ok: true });
          break;
        }
        try {
          await txClient.query('ROLLBACK');
        } finally {
          txClient.release();
          txClient = null;
        }
        reply({ ok: true });
        break;
      case 'close':
        await pool.end();
        reply({ ok: true });
        process.exit(0);
        break;
      default:
        reply({ ok: false, error: `unknown op: ${op}` });
    }
  } catch (e) {
    if (txClient && (op === 'query' || op === 'get' || op === 'run')) {
      try {
        await txClient.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      try {
        txClient.release();
      } catch (_) {
        /* ignore */
      }
      txClient = null;
    }
    reply({ ok: false, error: e.message });
  }
});
