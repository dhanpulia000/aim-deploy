const pg = require('./db-pg-sync');
const { adaptSqlForPostgres, toParamArray } = require('./sql-for-pg');
const logger = require('../utils/logger');

function prepare(sql, params) {
  const arr = toParamArray(params);
  let pgSql = adaptSqlForPostgres(sql);
  return { sql: pgSql, params: arr };
}

function query(sql, params = {}) {
  try {
    const { sql: pgSql, params: arr } = prepare(sql, params);
    return pg.query(pgSql, arr);
  } catch (error) {
    logger.error('Query execution failed', { error: error.message, sql });
    throw error;
  }
}

function queryOne(sql, params = {}) {
  try {
    const { sql: pgSql, params: arr } = prepare(sql, params);
    return pg.queryOne(pgSql, arr);
  } catch (error) {
    logger.error('Query execution failed', { error: error.message, sql });
    throw error;
  }
}

function execute(sql, params = {}) {
  try {
    const { sql: pgSql, params: arr } = prepare(sql, params);
    let finalSql = pgSql.trim();
    const isInsert = /^\s*insert\s+/i.test(finalSql);
    if (isInsert && !/\breturning\b/i.test(finalSql)) {
      if (
        /^INSERT\s+INTO\s+"?Project"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?MonitoredBoard"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?StepFloating"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?HandoverRecord"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?WorkChecklistItem"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?WorkChecklistExecution"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?AIPromptConfig"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?CalendarEvent"?/i.test(finalSql) ||
        /^INSERT\s+INTO\s+"?MonitoringKeyword"?/i.test(finalSql)
      ) {
        finalSql = `${finalSql} RETURNING id`;
      }
    }
    return pg.run(finalSql, arr);
  } catch (error) {
    logger.error('Execute failed', { error: error.message, sql });
    throw error;
  }
}

function executeTransaction(callback) {
  pg.begin();
  try {
    const out = callback();
    pg.commit();
    return out;
  } catch (e) {
    try {
      pg.rollback();
    } catch (rbErr) {
      logger.warn('Rollback failed', { error: rbErr.message });
    }
    throw e;
  }
}

function checkConnection() {
  try {
    pg.ping();
    return true;
  } catch (error) {
    logger.error('Database connection check failed', { error: error.message });
    return false;
  }
}

function disconnect() {
  try {
    pg.closePool();
    logger.info('[PostgreSQL] Connection pool closed');
  } catch (error) {
    logger.error('Database disconnect failed', { error: error.message });
  }
}

function getStatus() {
  try {
    const connected = checkConnection();
    return {
      connected,
      type: 'postgresql',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      connected: false,
      type: 'postgresql',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

function safeQuery(queryFn, defaultValue = null) {
  try {
    return queryFn();
  } catch (error) {
    logger.error('Database query failed', { error: error.message });
    return defaultValue;
  }
}

function paginatedQuery(tableName, options = {}) {
  const {
    where = '',
    orderBy = '',
    page = 1,
    limit = 10,
    params = {}
  } = options;

  const skip = (page - 1) * limit;

  try {
    let dataQuery = `SELECT * FROM ${tableName}`;
    if (where) dataQuery += ` WHERE ${where}`;
    if (orderBy) dataQuery += ` ORDER BY ${orderBy}`;
    dataQuery += ' LIMIT ? OFFSET ?';

    const data = query(dataQuery, [...toParamArray(params), limit, skip]);

    let countQuery = `SELECT COUNT(*)::int as total FROM ${tableName}`;
    if (where) countQuery += ` WHERE ${where}`;
    const countRow = queryOne(countQuery, params);
    const total = countRow?.total ?? 0;

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Paginated query failed', { error: error.message, table: tableName });
    throw error;
  }
}

function tableExists(name) {
  const row = queryOne(
    `SELECT 1 AS x FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return !!row;
}

function getDatabase() {
  return {
    prepare() {
      throw new Error('getDatabase().prepare is not supported on PostgreSQL');
    },
    exec() {
      throw new Error('getDatabase().exec is not supported on PostgreSQL; use Prisma migrations');
    }
  };
}

const db = {
  _postgres: true,
  prepare() {
    throw new Error('db.prepare is not supported on PostgreSQL');
  }
};

module.exports = {
  db,
  getDatabase,
  checkConnection,
  executeTransaction,
  safeQuery,
  paginatedQuery,
  disconnect,
  getStatus,
  query,
  queryOne,
  execute,
  tableExists
};
