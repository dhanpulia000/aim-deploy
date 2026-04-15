/** KST 기준 캘린더 날짜 YYYY-MM-DD (API 날짜 필터와 동일) */
export function kstCalendarDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** KST 달력 기준으로 `from`에서 `days`일 전 날짜(0이면 from의 KST 일자). 오늘 포함 7일 구간의 시작일 등에 사용 */
export function kstCalendarDateMinusDays(days: number, from: Date = new Date()): string {
  const anchor = kstCalendarDateString(from);
  const parts = anchor.split("-").map((s) => parseInt(s, 10));
  const y = parts[0];
  const M = parts[1];
  const d = parts[2];
  if (!y || !M || !d) return anchor;
  const kstNoonUtcMs = Date.UTC(y, M - 1, d, 3, 0, 0);
  const shifted = new Date(kstNoonUtcMs - days * 86400000);
  return kstCalendarDateString(shifted);
}

/** KST 달력 문자열 YYYY-MM-DD 구간(포함)의 모든 일자를 오름차순으로 */
export function kstInclusiveDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  for (let guard = 0; guard < 400 && cur <= end; guard++) {
    out.push(cur);
    if (cur === end) break;
    const parts = cur.split("-").map((s) => parseInt(s, 10));
    const y = parts[0];
    const M = parts[1];
    const d = parts[2];
    if (!y || !M || !d) break;
    const ms = Date.UTC(y, M - 1, d, 3, 0, 0) + 86400000;
    cur = kstCalendarDateString(new Date(ms));
  }
  return out;
}

export const fmt = {
  time: (ms: number) =>
    new Date(ms).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
    }),
  dur: (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s}s`;
  },
};

function kstHourMinuteParts(d: Date): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return {
    h: parseInt(parts.find((x) => x.type === "hour")?.value ?? "0", 10),
    m: parseInt(parts.find((x) => x.type === "minute")?.value ?? "0", 10),
  };
}

/** 목록에 시각이 없어 DB에 자정으로만 들어간 경우(행마다 구분 불가) */
function isKstMidnight(d: Date): boolean {
  const { h, m } = kstHourMinuteParts(d);
  return h === 0 && m === 0;
}

function formatKstHm(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * 클랜(이슈) 목록 날짜: DB `date`(게시일) 우선.
 * 원문 시각이 자정(목록에 시간 없음 → 워커가 00:00으로 넣은 경우)이면 수집 시각(createdAt)을 붙여 행을 구분.
 */
export function formatClanIssueListDate(issue: {
  date?: string | null;
  sourceCreatedAt?: string | null;
  createdAt?: string | null;
}): string {
  const rawDay = String(issue.date ?? "").trim().slice(0, 10);
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(rawDay);

  if (validDay && issue.sourceCreatedAt) {
    const src = new Date(issue.sourceCreatedAt);
    if (!Number.isNaN(src.getTime())) {
      const srcDay = kstCalendarDateString(src);
      if (srcDay === rawDay) {
        if (isKstMidnight(src) && issue.createdAt) {
          const col = new Date(issue.createdAt);
          if (!Number.isNaN(col.getTime())) {
            return `${rawDay} · 수집 ${formatKstHm(col)}`;
          }
        }
        const timePart = formatKstHm(src);
        return `${rawDay} ${timePart}`;
      }
    }
  }

  if (validDay) return rawDay;

  if (issue.sourceCreatedAt) {
    const src = new Date(issue.sourceCreatedAt);
    if (!Number.isNaN(src.getTime())) return fmt.time(src.getTime());
  }
  if (issue.createdAt) {
    const c = new Date(issue.createdAt);
    if (!Number.isNaN(c.getTime())) return fmt.time(c.getTime());
  }
  return "-";
}












