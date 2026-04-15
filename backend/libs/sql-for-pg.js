/**
 * SQLite 관행의 SQL을 node-pg 실행용으로 가볍게 변환합니다.
 * (전체 호환을 보장하지 않으며, 필요 시 쿼리별로 보강합니다.)
 */

function toParamArray(params) {
  if (Array.isArray(params)) return params.slice();
  if (params && typeof params === 'object') return Object.values(params);
  return [];
}

function placeholdersToNumbered(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Prisma PostgreSQL 마이그레이션은 식별자를 따옴표로 생성합니다 ("User", "Agent", …).
 * 따옴표 없는 FROM User 는 PG에서 소문자 user 로 해석되어 relation 오류가 납니다.
 * 긴 이름부터 치환해 CategoryGroup vs Category 를 깨뜨리지 않습니다.
 */
const PRISMA_PG_TABLES = [
  'WorkChecklistItemSortByType',
  'CustomerFeedbackNoticeRead',
  'WorkChecklistExecution',
  'CustomerFeedbackNotice',
  'YouTubeVideoCaptionCache',
  'BoardListDailySnapshot',
  'WorkChecklistBanner',
  'ClassificationRule',
  'LoginOtpChallenge',
  'WorkChecklistItem',
  'MonitoringKeyword',
  'IssueCommentWatch',
  'MonitoringConfig',
  'WorkNotification',
  'PartnerSentVideo',
  'ReportItemIssue',
  'ReportItemData',
  'MonitoredBoard',
  'HandoverRecord',
  'LineChatTarget',
  'AIPromptConfig',
  'ReportItemVOC',
  'CategoryGroup',
  'IssueShareLog',
  'CalendarEvent',
  'AgentSchedule',
  'StepFloating',
  'IssueComment',
  'WeeklyReport',
  'MonitoredUrl',
  'WeeklyStat',
  'SystemCode',
  'SlaPolicy',
  'IssueLock',
  'AuditLog',
  'Category',
  'Project',
  'Channel',
  'Report',
  'RawLog',
  'Agent',
  'User'
];

function quotePrismaTablesForPostgres(sql) {
  let s = sql;
  for (const t of PRISMA_PG_TABLES) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\bFROM\\s+${esc}\\b`, 'gi'), `FROM "${t}"`);
    s = s.replace(new RegExp(`\\bJOIN\\s+${esc}\\b`, 'gi'), `JOIN "${t}"`);
    s = s.replace(new RegExp(`\\bINTO\\s+${esc}\\b`, 'gi'), `INTO "${t}"`);
    s = s.replace(new RegExp(`\\bUPDATE\\s+${esc}\\b`, 'gi'), `UPDATE "${t}"`);
    s = s.replace(new RegExp(`\\bDELETE\\s+FROM\\s+${esc}\\b`, 'gi'), `DELETE FROM "${t}"`);
  }
  return s;
}

/**
 * SQL 문자열 리터럴("...") 밖의 구간만 변환합니다 (이미 따옴표된 식별자 보호).
 */
function mapOutsideDoubleQuotes(sql, mapper) {
  const parts = String(sql).split('"');
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = mapper(parts[i]);
  }
  return parts.join('"');
}

/**
 * INSERT INTO Table (a, b, c) VALUES — 테이블명 따옴표 치환 전에 실행해야
 * mapOutsideDoubleQuotes 가 문자열을 잘라 컬럼 목록과 INTO 를 분리하지 않습니다.
 */
function quotePrismaInsertColumnListsBeforeTableQuotes(sql) {
  let s = String(sql);
  for (const t of PRISMA_PG_TABLES) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\bINTO\\s+${esc}\\s*\\(\\s*([^)]+?)\\s*\\)\\s+VALUES`, 'gi');
    s = s.replace(re, (full, colList) => {
      const cols = colList.split(',').map((c) => c.trim()).filter(Boolean);
      const out = cols.map((c) => {
        if (/^".*"$/.test(c)) return c;
        if (/^[a-z][a-zA-Z0-9]*[A-Z]/.test(c)) return `"${c}"`;
        return c;
      });
      return `INTO ${t} (${out.join(', ')}) VALUES`;
    });
  }
  return s;
}

/**
 * Prisma PostgreSQL 마이그레이션은 camelCase 컬럼을 따옴표로 생성합니다.
 * 따옴표 없는 sp.projectId 는 PG에서 sp.projectid 로 해석되어 컬럼이 없어집니다.
 */
function quoteCamelCaseColumnsForPostgres(sql) {
  // WorkGuide는 환경에 따라 "Prisma quoted schema"가 아니라
  // 별도의 RAG/가이드 테이블(소문자 컬럼)로 운용되는 경우가 있습니다.
  // 이 경우 camelCase 컬럼을 강제로 따옴표 처리하면 실제 컬럼명이 맞지 않아 실패합니다.
  if (/\bWorkGuide\b/i.test(String(sql))) return String(sql);
  return String(sql).replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*[A-Z][a-zA-Z0-9_]*)\b/g,
    '$1."$2"'
  );
}

/**
 * 테이블 접두사 없는 lowerCamel 컬럼 (WHERE projectId =, ORDER BY createdAt, IS NULL 등).
 */
function quoteUnqualifiedCamelCaseColumnsForPostgres(sql) {
  if (/\bWorkGuide\b/i.test(String(sql))) return String(sql);
  return mapOutsideDoubleQuotes(sql, (seg) => {
    let s = seg;
    s = s.replace(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s*=\s*/g, '"$1" = ');
    s = s.replace(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s+LIKE\b/gi, '"$1" LIKE');
    s = s.replace(/\benabled\s*=\s*/gi, '"enabled" = ');
    s = s.replace(/\benabled\s+IS\s+(NOT\s+)?NULL\b/gi, (m, notPart) => `"enabled" IS ${notPart ? 'NOT ' : ''}NULL`);
    s = s.replace(/\bCOALESCE\s*\(\s*label\s*,/gi, 'COALESCE("label",');
    s = s.replace(
      /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s+IN\b/gi,
      '"$1" IN'
    );
    s = s.replace(
      /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s+IS\s+(NOT\s+)?NULL\b/gi,
      (m, col, notPart) => `"${col}" IS ${notPart ? 'NOT ' : ''}NULL`
    );
    s = s.replace(
      /\bCOALESCE\s*\(\s*([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s*,\s*([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s*\)/gi,
      'COALESCE("$1", "$2")'
    );
    return s;
  });
}

/** SQLite DATE(col, '+9 hours') → KST 날짜 (PostgreSQL) */
function replaceDateCreatedAtKst(sql) {
  return String(sql).replace(
    /DATE\s*\(\s*i\.createdAt\s*,\s*'\+9 hours'\s*\)/gi,
    "((i.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date)"
  );
}

/**
 * Prisma/PostgreSQL는 camelCase 컬럼을 따옴표로 생성합니다.
 * table.col 형태는 별도 처리하고, 여기서는 점으로 이어지지 않은 식별자만 인용합니다.
 */
const STANDALONE_QUOTED_COLUMNS = [
  'notificationDate',
  'notificationTime',
  'monitoredBoardId',
  'categoryGroupId',
  'assignedAgentId',
  'externalSource',
  'externalPostId',
  'sourceUrl',
  'windowStartTime',
  'windowEndTime',
  'intervalMinutes',
  'discordWebhookUrl',
  'discordMention',
  'calendarEventId',
  'lastSentDate',
  'processingStatus',
  'excludedFromReport',
  'checkInterval',
  'lastArticleId',
  'lastScanAt',
  'slackMessageTs',
  'repeatType',
  'nextRetryAt',
  'projectId',
  'issueId',
  'authorId',
  'reportId',
  'categoryId',
  'displayOrder',
  'createdAt',
  'updatedAt',
  'isProcessed',
  'lockedAt',
  'lastError',
  'cafeGame',
  'listUrl',
  'isActive',
  'enabled',
  'boardId',
  'articleId',
  'metadata',
  'startDate',
  'endDate',
  'dayOfWeek',
  'dayOfMonth',
  'workName'
];

function quoteStandaloneCamelColumnsForPostgres(sql) {
  if (/\bWorkGuide\b/i.test(String(sql))) return String(sql);
  return mapOutsideDoubleQuotes(sql, (seg) => {
    let s = seg;
    const cols = [...STANDALONE_QUOTED_COLUMNS].sort((a, b) => b.length - a.length);
    for (const col of cols) {
      const esc = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\w".])\\b${esc}\\b(?!")`, 'g');
      s = s.replace(re, `"${col}"`);
    }
    return s;
  });
}

/** ORDER BY a DESC, b ASC — 단순 식별자만 따옴표 (함수·점 포함 시 유지) */
function quoteOrderBySimpleIdentifiers(sql) {
  // WorkGuide는 init-guide-schema(Postgres) 기준 소문자 컬럼명이며,
  // /i 플래그 때문에 priority 등이 camelCase로 오인되어 "priority" 로 인용되기도 합니다.
  // ORDER BY createdAt → "createdAt" 는 실제 컬럼 createdat 과 불일치하여 목록 조회가 실패합니다.
  if (/\bWorkGuide\b/i.test(String(sql))) return String(sql);
  return mapOutsideDoubleQuotes(sql, (seg) =>
    seg.replace(
      /\bORDER BY\s+([^;\n]+?)(?=\s+LIMIT\b|\s+OFFSET\b|\s*$)/gi,
      (full, clause) => {
        const parts = clause.split(',').map((raw) => {
          const t = raw.trim();
          const m = t.match(/^([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)(\s+(?:ASC|DESC))?$/i);
          if (m && !t.includes('(') && !t.includes('.') && !t.includes('"')) {
            return `"${m[1]}"${m[2] || ''}`;
          }
          return t;
        });
        return `ORDER BY ${parts.join(', ')}`;
      }
    )
  );
}

/** GROUP BY issueId — 단일/쉼표 구분 단순 컬럼 */
function quoteGroupBySimpleIdentifiers(sql) {
  return mapOutsideDoubleQuotes(sql, (seg) =>
    seg.replace(
      /\bGROUP BY\s+([^)\n;]+?)(?=\s*\)|\s+HAVING\b|\s+ORDER\b|\s+LIMIT\b|\s*$)/gi,
      (full, clause) => {
        if (clause.includes('(') || clause.includes('.')) return full;
        const parts = clause.split(',').map((raw) => {
          const t = raw.trim();
          if (/^[a-z][a-zA-Z0-9]*[A-Z]/.test(t) && !t.includes('"')) return `"${t}"`;
          return t;
        });
        return `GROUP BY ${parts.join(', ')}`;
      }
    )
  );
}

function fixSqliteBooleanLiteralsForPostgres(sql) {
  let s = sql;
  const hasMonitoredBoard = /\bMonitoredBoard\b/i.test(s);

  // Prisma Boolean 컬럼: SQLite 관행 isActive = 1 → PG 에서는 TRUE (전 테이블 공통)
  s = s.replace(/"isActive"\s*=\s*1\b/gi, '"isActive" = TRUE');
  s = s.replace(/"isActive"\s*=\s*0\b/gi, '"isActive" = FALSE');
  s = s.replace(/\.\"isActive\"\s*=\s*1\b/g, '."isActive" = TRUE');
  s = s.replace(/\.\"isActive\"\s*=\s*0\b/g, '."isActive" = FALSE');

  s = s.replace(/"isProcessed"\s*=\s*0\b/gi, '"isProcessed" = FALSE');
  s = s.replace(/"isProcessed"\s*=\s*1\b/gi, '"isProcessed" = TRUE');

  s = s.replace(/\.\"excludedFromReport\"\s*=\s*0\b/g, '."excludedFromReport" = FALSE');
  s = s.replace(/\.\"excludedFromReport\"\s*=\s*1\b/g, '."excludedFromReport" = TRUE');
  s = s.replace(/"excludedFromReport"\s*=\s*0\b/gi, '"excludedFromReport" = FALSE');
  s = s.replace(/"excludedFromReport"\s*=\s*1\b/gi, '"excludedFromReport" = TRUE');

  if (hasMonitoredBoard) {
    s = s.replace(/"enabled"\s*=\s*0\b/gi, '"enabled" = FALSE');
    s = s.replace(/"enabled"\s*=\s*1\b/gi, '"enabled" = TRUE');
  }

  return s;
}

function adaptSqlForPostgres(sql) {
  let s = String(sql);

  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  s = replaceDateCreatedAtKst(s);

  s = s.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  s = s.replace(/datetime\("now"\)/gi, 'CURRENT_TIMESTAMP');

  s = s.replace(
    /DATE\(datetime\(i\.createdAt,\s*'\+9 hours'\)\)/gi,
    "((i.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date)"
  );
  s = s.replace(
    /strftime\('%Y-%m', datetime\(i\.createdAt, '\+9 hours'\)\)/gi,
    "to_char((i.\"createdAt\" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')"
  );
  s = s.replace(
    /\(strftime\('%G', datetime\(i\.createdAt, '\+9 hours'\)\) \|\| '-W' \|\| strftime\('%V', datetime\(i\.createdAt, '\+9 hours'\)\)\)/gi,
    "(to_char((i.\"createdAt\" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'IYYY') || '-W' || to_char((i.\"createdAt\" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'IW'))"
  );

  const flat = s.replace(/\s+/g, ' ');
  if (
    /INSERT\s+OR\s+REPLACE\s+INTO\s+MonitoringConfig/i.test(flat) &&
    /\(key,\s*value,\s*updatedAt\)/i.test(flat) &&
    /\(\s*\?\s*,\s*\?\s*,\s*\?\s*\)/.test(flat)
  ) {
    return `INSERT INTO "MonitoringConfig" ("key", "value", "updatedAt") VALUES ($1, $2, $3) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`;
  }

  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+RawLog/gi.test(s)) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+RawLog/gi, 'INSERT INTO "RawLog"');
    const li = s.lastIndexOf(')');
    if (li !== -1) {
      s = `${s.slice(0, li + 1)} ON CONFLICT ("id") DO NOTHING ${s.slice(li + 1)}`;
    }
  }

  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+PartnerSentVideo/gi.test(s)) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+PartnerSentVideo/gi, 'INSERT INTO "PartnerSentVideo"');
    const li = s.lastIndexOf(')');
    if (li !== -1) {
      s = `${s.slice(0, li + 1)} ON CONFLICT ("platform", "videoId") DO NOTHING ${s.slice(li + 1)}`;
    }
  }

  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+WorkChecklistBanner/gi.test(s)) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+WorkChecklistBanner/gi, 'INSERT INTO "WorkChecklistBanner"');
    const li = s.lastIndexOf(')');
    if (li !== -1) {
      s = `${s.slice(0, li + 1)} ON CONFLICT ("id") DO NOTHING ${s.slice(li + 1)}`;
    }
  }

  s = s.replace(/\benabled\s*=\s*1\b/gi, 'enabled = TRUE');
  s = s.replace(/\benabled\s*=\s*0\b/gi, 'enabled = FALSE');

  s = quotePrismaInsertColumnListsBeforeTableQuotes(s);
  s = quotePrismaTablesForPostgres(s);
  s = quoteUnqualifiedCamelCaseColumnsForPostgres(s);
  s = quoteCamelCaseColumnsForPostgres(s);
  s = quoteOrderBySimpleIdentifiers(s);
  s = quoteGroupBySimpleIdentifiers(s);
  s = quoteStandaloneCamelColumnsForPostgres(s);
  s = fixSqliteBooleanLiteralsForPostgres(s);

  return placeholdersToNumbered(s);
}

module.exports = {
  adaptSqlForPostgres,
  toParamArray
};
