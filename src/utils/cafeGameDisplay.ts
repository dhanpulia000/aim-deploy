/**
 * SystemCode CRAWLER_GAME ↔ MonitoredBoard.cafeGame 표시·역매핑
 */

export type CrawlerGameDto = {
  id: number;
  code: string;
  label: string;
  displayOrder?: number | null;
  metadata?: Record<string, unknown> | null;
};

export function buildCafeGameLookups(games: CrawlerGameDto[]) {
  const labelByCode: Record<string, string> = {};
  const externalToCode: Record<string, string> = {};
  for (const g of games) {
    labelByCode[g.code] = g.label;
    const m =
      g.metadata && typeof g.metadata === "object"
        ? (g.metadata as Record<string, unknown>)
        : {};
    const ext = m.externalSource;
    const clan = m.clanExternalSource;
    if (typeof ext === "string") externalToCode[ext] = g.code;
    if (typeof clan === "string") externalToCode[clan] = g.code;
  }
  return { labelByCode, externalToCode };
}

export function inferCafeGameCodeFromExternalSource(
  externalSource: string | null | undefined,
  externalToCode: Record<string, string>
): string | null {
  if (!externalSource) return null;
  if (externalToCode[externalSource]) return externalToCode[externalSource];
  for (const [ext, code] of Object.entries(externalToCode)) {
    if (externalSource.startsWith(ext)) return code;
  }
  // Discourse (PlayInZOI) integration
  if (externalSource === "DISCOURSE_PLAYINZOI") return "INZOI";
  if (
    externalSource.includes("PUBG_MOBILE") ||
    externalSource === "NAVER_CAFE_PUBG_MOBILE"
  )
    return "PUBG_MOBILE";
  if (
    externalSource.includes("PUBG_PC") ||
    externalSource === "NAVER_CAFE_PUBG_PC" ||
    externalSource === "NAVER_CAFE_PUBG_PC_CLAN"
  )
    return "PUBG_PC";
  return null;
}

export function ticketCafeGameFields(
  issue: {
    externalSource?: string | null;
    monitoredBoard?: { cafeGame?: string | null } | null;
    monitoredBoard_cafeGame?: string | null;
  },
  lookups: ReturnType<typeof buildCafeGameLookups>
): { cafeGameCode: string | null; gameName: string | null } {
  const boardCode =
    issue.monitoredBoard?.cafeGame ?? issue.monitoredBoard_cafeGame ?? null;
  const code =
    boardCode && boardCode.length > 0
      ? boardCode
      : inferCafeGameCodeFromExternalSource(issue.externalSource, lookups.externalToCode);
  if (!code) {
    return { cafeGameCode: null, gameName: null };
  }
  const gameName =
    lookups.labelByCode[code] ??
    (code === "INZOI" ? "inZOI" : code);
  return { cafeGameCode: code, gameName };
}

/** 로컬 필터·구 데이터(gameName 문자열)와의 호환용 — 코드 기준 필터가 옛 표시명을 만날 때 */
export const LEGACY_CAFE_GAME_NAMES_BY_CODE: Record<string, readonly string[]> = {
  PUBG_PC: ["PUBG_PC", "데스크톱(공식 PC)"],
  PUBG_MOBILE: ["PUBG_MOBILE", "모바일(공식)"]
};

export function shortCafeGameTableLabel(
  code: string | null | undefined,
  labelByCode: Record<string, string>
): string {
  if (!code) return "—";
  const full = labelByCode[code];
  if (full) {
    const compact = full.replace(/\s*\(naver\.com\)\s*$/i, "").trim();
    return compact.length <= 14 ? compact : `${compact.slice(0, 12)}…`;
  }
  return code.length <= 8 ? code : `${code.slice(0, 6)}…`;
}
