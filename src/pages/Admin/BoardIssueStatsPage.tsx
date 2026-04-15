import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { kstCalendarDateString } from "../../utils/formatters";
import { Button } from "../../components/ui/Button";
import { useCrawlerGames } from "../../hooks/useCrawlerGames";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

interface BoardStatRow {
  id: number;
  name: string;
  cafeGame: string | null;
  projectId: number | null;
  projectName?: string | null;
  listUrl: string | null;
  url: string | null;
  issueCount: number;
  ingestCount: number;
  /** 네이버 목록에서 읽은 행의 날짜를 기준으로 기간 내 합산( includeListBased=true 일 때만) */
  listBasedCount?: number | null;
  listBasedTotalRows?: number;
  listBasedSkipped?: string | null;
  listBasedError?: string | null;
  /** true when 목록(기간) 합계가 BoardListDailySnapshot에서만 조회됨 */
  listBasedFromDb?: boolean;
}

interface BoardStatsResponse {
  boards: BoardStatRow[];
  totalIssueCount: number;
  totalIngestCount: number;
  totalListBasedCountInRange?: number;
  listBasedIncluded?: boolean;
  range: { startDate: string | null; endDate: string | null };
}

interface MonitoredBoardOption {
  id: number;
  name: string;
  cafeGame: string | null;
}

/** API/JSON에서 숫자가 문자열로 올 때 목록(기간)이 전부 "—"로 보이는 문제 방지 */
function coerceFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeListBasedCount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = coerceFiniteNumber(value);
  return n !== undefined ? n : null;
}

function normalizeBoardStatsPayload(data: BoardStatsResponse): BoardStatsResponse {
  const boards = (data.boards ?? []).map((b) => {
    const issueCount = coerceFiniteNumber(b.issueCount) ?? 0;
    const ingestCount = coerceFiniteNumber(b.ingestCount) ?? issueCount;
    const listBasedCount = normalizeListBasedCount(b.listBasedCount);
    const totalRows = coerceFiniteNumber(b.listBasedTotalRows as unknown);
    return {
      ...b,
      issueCount,
      ingestCount,
      listBasedCount,
      listBasedTotalRows: totalRows !== undefined ? totalRows : b.listBasedTotalRows,
      listBasedFromDb: b.listBasedFromDb === true,
    };
  });
  const totalIssue = coerceFiniteNumber(data.totalIssueCount) ?? boards.reduce((s, r) => s + r.issueCount, 0);
  const totalIngest = coerceFiniteNumber(data.totalIngestCount) ?? totalIssue;
  const totalList =
    coerceFiniteNumber(data.totalListBasedCountInRange as unknown) ??
    boards.reduce((s, r) => s + (typeof r.listBasedCount === "number" ? r.listBasedCount : 0), 0);
  return {
    ...data,
    boards,
    totalIssueCount: totalIssue,
    totalIngestCount: totalIngest,
    totalListBasedCountInRange: data.listBasedIncluded ? totalList : data.totalListBasedCountInRange,
  };
}

function finiteListBasedCount(row: BoardStatRow): number | undefined {
  const v = row.listBasedCount;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function formatCafeGame(cafeGame: string | null, labelByCode: Record<string, string>): string {
  if (!cafeGame) return "—";
  return labelByCode[cafeGame] ?? cafeGame;
}

function monitoredBoardListHref(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `https://${s}`;
}

function resolveMonitoredBoardProjectLabel(
  projectId: number,
  projects: { id: number; name?: string | null }[],
  apiProjectName: string | null | undefined,
  unknownLabel: string
): string {
  const fromContext = projects.find((p) => p.id === projectId)?.name?.trim();
  if (fromContext) return fromContext;
  const fromApi = apiProjectName?.trim();
  if (fromApi) return fromApi;
  return unknownLabel;
}

export default function BoardIssueStatsPage() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token, selectedProjectId, projects, user } = useAuth();
  const [startDate, setStartDate] = useState(() => kstCalendarDateString());
  const [endDate, setEndDate] = useState(() => kstCalendarDateString());
  const [hideZero, setHideZero] = useState(false);
  /** 네이버 게시판 목록을 열어 실제 글 수에 가까운 집계(다소 시간 소요) */
  const [includeListBased, setIncludeListBased] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [boardOptions, setBoardOptions] = useState<MonitoredBoardOption[]>([]);
  // null = 전체 선택
  const [selectedBoardIds, setSelectedBoardIds] = useState<number[] | null>(null);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [payload, setPayload] = useState<BoardStatsResponse | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const BOARD_ISSUE_STATS_SELECTION_KEY = "boardIssueStats.selectedBoardIds";

  const authHeaders = useMemo(() => createAuthHeaders(token) ?? {}, [token]);
  const { lookups: crawlerLookups } = useCrawlerGames(token);

  const isAdmin = user?.role === "ADMIN";

  const allBoardIds = useMemo(() => boardOptions.map((b) => b.id), [boardOptions]);
  const isBoardSelected = useCallback(
    (id: number) => selectedBoardIds == null ? true : selectedBoardIds.includes(id),
    [selectedBoardIds]
  );

  const toggleBoard = useCallback(
    (id: number) => {
      if (allBoardIds.length === 0) return;
      setSelectedBoardIds((prev) => {
        const currentIds = prev == null ? allBoardIds : prev;
        const set = new Set(currentIds);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        const next = Array.from(set);
        // 전체면 null로 유지(기존 동작과 호환)
        return next.length === allBoardIds.length ? null : next;
      });
    },
    [allBoardIds]
  );

  useEffect(() => {
    const run = async () => {
      if (!token) return;
      // 관리자 선택 기준을 서버(공유 설정)에서 먼저 불러온다.
      setConfigLoaded(false);
      try {
        const res = await fetch(`/api/monitoring/config/${BOARD_ISSUE_STATS_SELECTION_KEY}`, {
          headers: authHeaders,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json().catch(() => ({}));
        const cfg = body?.data ?? body;
        const rawValue = cfg?.value ?? cfg?.data?.value ?? null;

        // value가 없으면 전체(all)로 간주
        if (rawValue == null || rawValue === "" || rawValue === "__ALL__") {
          setSelectedBoardIds(null);
        } else {
          // JSON 배열로 저장할 수 있고, 구형/예외를 위해 CSV도 허용
          try {
            const parsed = JSON.parse(String(rawValue));
            if (Array.isArray(parsed)) setSelectedBoardIds(parsed.map((n) => Number(n)).filter((n) => !Number.isNaN(n)));
            else setSelectedBoardIds(null);
          } catch {
            const ids = String(rawValue)
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => !Number.isNaN(n));
            setSelectedBoardIds(ids.length ? ids : null);
          }
        }
      } catch (e) {
        // 설정을 못 읽으면 기본은 전체(all)
        setSelectedBoardIds(null);
      } finally {
        setConfigLoaded(true);
      }

      if (!isAdmin) {
        setBoardOptions([]);
        setBoardsLoading(false);
        return;
      }
      setBoardsLoading(true);
      try {
        const res = await fetch(`/api/monitoring/boards?isActive=true&enabled=true`, {
          headers: authHeaders
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = await res.json();
        const boards: MonitoredBoardOption[] = (body.data ?? body ?? []).map((b: any) => ({
          id: Number(b.id),
          name: (b.name || b.label || '').toString(),
          cafeGame: b.cafeGame ?? null
        }));
        setBoardOptions(boards.filter((b) => !Number.isNaN(b.id) && b.name.trim() !== ''));
      } catch (e) {
        // 표시 대상 선택 자체는 optional이므로 실패해도 stats 화면은 동작하도록 둔다.
        setBoardOptions([]);
      } finally {
        setBoardsLoading(false);
      }
    };
    void run();
  }, [token, authHeaders, isAdmin]);

  const persistInitRef = useRef(false);
  useEffect(() => {
    // 비관리자는 서버 설정을 갱신하지 않는다.
    if (!isAdmin) return;
    if (!configLoaded) return;

    // 초기 로딩 때는 PUT을 생략한다.
    if (!persistInitRef.current) {
      persistInitRef.current = true;
      return;
    }

    const persist = async () => {
      const value = selectedBoardIds == null ? "__ALL__" : JSON.stringify(selectedBoardIds);
      await fetch(`/api/monitoring/config/${BOARD_ISSUE_STATS_SELECTION_KEY}`, {
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value, description: t("admin.boardIssueStats.configDescription") }),
      });
    };

    void persist().catch(() => {
      // 저장 실패는 화면이 깨지는 것보다 나중에 다시 시도하는 게 안전
    });
  }, [isAdmin, configLoaded, selectedBoardIds, authHeaders, t]);

  const loadSeqRef = useRef(0);

  const loadStats = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    setListError(null);
    setListLoading(false);

    try {
      // 1) 이슈 DB 통계: 화면을 먼저 빠르게 보여주기 위해 무조건 먼저 로드
      const baseParams = new URLSearchParams();
      if (startDate) baseParams.append("startDate", startDate);
      if (endDate) baseParams.append("endDate", endDate);
      if (selectedProjectId != null) baseParams.append("projectId", String(selectedProjectId));
      if (selectedBoardIds != null) baseParams.append("boardIds", selectedBoardIds.join(','));

      const baseRes = await fetch(`/api/issues/monitored-board-stats?${baseParams.toString()}`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(30_000),
      });
      if (!baseRes.ok) {
        const body = await baseRes.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${baseRes.status}`);
      }

      const baseBody = await baseRes.json();
      const baseRaw: BoardStatsResponse = baseBody.data || baseBody;
      if (seq === loadSeqRef.current) setPayload(normalizeBoardStatsPayload(baseRaw));
    } catch (e) {
      if (seq === loadSeqRef.current) {
        setPayload(null);
        setError(e instanceof Error ? e.message : t("admin.boardIssueStats.errors.loadStatsFailed"));
      }
      return;
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }

    if (!includeListBased) return;

    // 2) 목록(네이버 목록) 통계: 느릴 수 있으니 비동기로 이어 로드
    setListLoading(true);
    try {
      const listParams = new URLSearchParams();
      if (startDate) listParams.append("startDate", startDate);
      if (endDate) listParams.append("endDate", endDate);
      if (selectedProjectId != null) listParams.append("projectId", String(selectedProjectId));
      if (selectedBoardIds != null) listParams.append("boardIds", selectedBoardIds.join(','));
      listParams.append("includeListBased", "true");
      listParams.append("maxPages", "2");

      const listRes = await fetch(`/api/issues/monitored-board-stats?${listParams.toString()}`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(600_000),
      });
      if (!listRes.ok) {
        const body = await listRes.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${listRes.status}`);
      }

      const listBody = await listRes.json();
      const listRaw: BoardStatsResponse = listBody.data || listBody;
      if (seq === loadSeqRef.current) setPayload(normalizeBoardStatsPayload(listRaw));
    } catch (e) {
      if (seq === loadSeqRef.current) {
        setListError(e instanceof Error ? e.message : t("admin.boardIssueStats.errors.loadListFailed"));
      }
    } finally {
      if (seq === loadSeqRef.current) setListLoading(false);
    }
  }, [startDate, endDate, selectedProjectId, authHeaders, includeListBased, selectedBoardIds, t]);

  useEffect(() => {
    if (!isAdmin && !configLoaded) return;
    void loadStats();
  }, [loadStats, configLoaded, isAdmin]);

  const visibleRows = useMemo(() => {
    const rows = payload?.boards ?? [];
    const filtered = hideZero ? rows.filter((r) => r.issueCount > 0) : rows;
    const loc = i18n.language?.startsWith("ko") ? "ko" : "en";
    return [...filtered].sort((a, b) => {
      if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
      return a.name.localeCompare(b.name, loc);
    });
  }, [payload, hideZero, i18n.language]);

  const visibleIssueSum = useMemo(
    () => visibleRows.reduce((s, r) => s + r.issueCount, 0),
    [visibleRows]
  );

  const visibleListSum = useMemo(
    () => visibleRows.reduce((s, r) => s + (finiteListBasedCount(r) ?? 0), 0),
    [visibleRows]
  );

  const hasListDateFilter = Boolean(startDate?.trim()) || Boolean(endDate?.trim());
  const listColumnTitle = hasListDateFilter
    ? t("admin.boardIssueStats.listColumn.inRange")
    : t("admin.boardIssueStats.listColumn.allRange");
  const listColumnHint = hasListDateFilter
    ? t("admin.boardIssueStats.listColumn.hintFiltered", {
        start: startDate || "…",
        end: endDate || "…",
      })
    : t("admin.boardIssueStats.listColumn.hintAll");

  const TABLE_COLS = 5;

  const rowsByProject = useMemo(() => {
    const map = new Map<
      string,
      { key: string; projectId: number | null; label: string; rows: BoardStatRow[] }
    >();
    for (const row of visibleRows) {
      const pid = row.projectId;
      const key = pid == null ? "__none__" : String(pid);
      const label =
        pid == null
          ? t("admin.monitoring.projects.unassigned")
          : resolveMonitoredBoardProjectLabel(
              pid,
              projects,
              row.projectName,
              t("admin.monitoring.projects.unknown")
            );
      if (!map.has(key)) {
        map.set(key, { key, projectId: pid, label, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }
    const groups = [...map.values()];
    for (const g of groups) {
      if (g.projectId != null) {
        const anyApiName = g.rows.map((r) => r.projectName).find((n) => n?.trim());
        g.label = resolveMonitoredBoardProjectLabel(
          g.projectId,
          projects,
          anyApiName,
          t("admin.monitoring.projects.unknown")
        );
      }
    }
    groups.sort((a, b) => {
      if (a.projectId == null && b.projectId != null) return 1;
      if (a.projectId != null && b.projectId == null) return -1;
      const loc = i18n.language?.startsWith("ko") ? "ko" : "en";
      return a.label.localeCompare(b.label, loc);
    });
    return groups;
  }, [visibleRows, projects, t, i18n.language]);

  const handleResetDates = () => {
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="ui-page">
      <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t("admin.boardIssueStats.title")}
          </h1>
        </div>

        <div className="ui-card ui-card-pad mb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
                <label htmlFor="board-stats-start" className="ui-label">
                  {t("admin.boardIssueStats.startDate")}
                </label>
                <LocalizedDateInput
                  id="board-stats-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="ui-input"
                />
              </div>
              <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
                <label htmlFor="board-stats-end" className="ui-label">
                  {t("admin.boardIssueStats.endDate")}
                </label>
                <LocalizedDateInput
                  id="board-stats-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="ui-input"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void loadStats()} variant="primary" className="min-w-[6.5rem] justify-center">
                  {t("admin.boardIssueStats.query")}
                </Button>
                <Button onClick={handleResetDates} variant="outline" className="min-w-[6rem] justify-center">
                  {t("admin.boardIssueStats.clearDates")}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => setHideZero(e.target.checked)}
                  className="rounded border-slate-300"
                />
                {t("admin.boardIssueStats.hideZeroIssueBoards")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={includeListBased}
                  onChange={(e) => setIncludeListBased(e.target.checked)}
                  className="rounded border-slate-300"
                />
                {t("admin.boardIssueStats.includeListBased")}
              </label>
            </div>
          </div>
        </div>

        {isAdmin ? (
          <div className="mb-6">
            <details className="ui-card ui-card-pad bg-slate-50/40 dark:bg-slate-900/30">
              <summary className="cursor-pointer select-none text-sm text-slate-700 dark:text-slate-200">
                {t("admin.boardIssueStats.selectBoards")}
                {boardsLoading ? ` ${t("admin.boardIssueStats.selectBoardsLoading")}` : ""}
              </summary>
              <div className="mt-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={selectedBoardIds == null}
                    onChange={() => setSelectedBoardIds(null)}
                    className="rounded border-slate-300"
                    disabled={boardsLoading || boardOptions.length === 0}
                  />
                  {t("admin.boardIssueStats.allBoards")}{" "}
                  {boardOptions.length ? t("admin.boardIssueStats.allBoardsCount", { n: boardOptions.length }) : ""}
                </label>

                <div className="mt-2 max-h-[260px] overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 px-3 py-2">
                  {boardOptions.length === 0 && boardsLoading ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {t("admin.boardIssueStats.boardsLoading")}
                    </div>
                  ) : null}
                  {boardOptions.length === 0 && !boardsLoading ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {t("admin.boardIssueStats.boardsLoadFailed")}
                    </div>
                  ) : null}

                  {boardOptions.map((b) => (
                    <label
                      key={b.id}
                      className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={isBoardSelected(b.id)}
                        onChange={() => toggleBoard(b.id)}
                        className="rounded border-slate-300"
                        disabled={boardsLoading || boardOptions.length === 0}
                      />
                      <span className="flex-1 truncate" title={b.name}>
                        {b.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {formatCafeGame(b.cafeGame, crawlerLookups.labelByCode)}
                      </span>
                    </label>
                  ))}
                </div>

                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {t("admin.boardIssueStats.selectBoardsHint")}
                </p>
              </div>
            </details>
          </div>
        ) : (
          <div className="mb-6 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.boardIssueStats.adminOnlySelect")}
          </div>
        )}

        {includeListBased ? (
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.boardIssueStats.listHelp1")}{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">/f-e/cafes/.../menus/N</code>
            {t("admin.boardIssueStats.listHelp2")}{" "}
            <button
              type="button"
              onClick={() => {
                window.history.pushState(null, "", "/board-list-snapshots");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              {t("admin.boardIssueStats.snapshotLink")}
            </button>
          </p>
        ) : null}
        {includeListBased && listLoading ? (
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{t("admin.boardIssueStats.listComputing")}</p>
        ) : null}
        {includeListBased && listError ? (
          <div className="ui-alert ui-alert-danger mb-4">
            <div className="ui-alert-body">
              {t("admin.boardIssueStats.listErrorPrefix")} {listError}
            </div>
          </div>
        ) : null}

        {payload && (
          <div
            className={`mb-6 grid grid-cols-1 gap-4 ${payload.listBasedIncluded ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}
          >
            <div className="ui-card p-5">
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {t("admin.boardIssueStats.cards.visibleBoards")}
              </div>
              <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {visibleRows.length}
                <span className="text-base font-normal text-slate-500"> / {payload.boards.length}</span>
              </div>
            </div>
            <div className="ui-card p-5 border-blue-200/80 dark:border-blue-900/40 bg-blue-50/30 dark:bg-blue-950/20">
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {t("admin.boardIssueStats.cards.issueSumVisible")}
              </div>
              <div className="text-2xl font-bold tabular-nums text-blue-950 dark:text-blue-100">
                {visibleIssueSum.toLocaleString()}
              </div>
              {hideZero && visibleRows.length < payload.boards.length ? (
                <div className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {t("admin.boardIssueStats.cards.issueSumAll")} {payload.totalIssueCount.toLocaleString()}
                </div>
              ) : null}
            </div>
            {payload.listBasedIncluded ? (
              <div className="ui-card p-5 border-emerald-200/80 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/20">
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {t("admin.boardIssueStats.cards.listSumVisible")}
                </div>
                <div className="text-2xl font-bold tabular-nums text-emerald-950 dark:text-emerald-100">
                  {visibleListSum.toLocaleString()}
                </div>
                {hideZero && visibleRows.length < payload.boards.length ? (
                  <div className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {t("admin.boardIssueStats.cards.listSumAll")}{" "}
                    {(payload.totalListBasedCountInRange ?? 0).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {error && (
          <div className="ui-alert ui-alert-danger mb-4">
            <div className="ui-alert-body">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="ui-card ui-card-pad text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            <p className="mt-2 text-slate-600 dark:text-slate-400">{t("admin.boardIssueStats.loading")}</p>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="ui-card ui-card-pad text-center py-12">
            <p className="text-slate-600 dark:text-slate-400">{t("admin.boardIssueStats.emptyNoBoards")}</p>
          </div>
        ) : (
          <div className="ui-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="ui-table w-full min-w-[520px]">
                <thead>
                  <tr>
                    <th className="ui-th text-left">{t("admin.boardIssueStats.table.board")}</th>
                    <th className="ui-th text-left w-36">{t("admin.boardIssueStats.table.game")}</th>
                    <th className="ui-th text-right w-28">{t("admin.boardIssueStats.table.issueDb")}</th>
                    <th className="ui-th text-right w-32" title={listColumnHint}>
                      {listColumnTitle}
                    </th>
                    <th className="ui-th text-left w-28">{t("admin.boardIssueStats.table.link")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsByProject.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="bg-slate-100/90 dark:bg-slate-800/70">
                        <td
                          colSpan={TABLE_COLS}
                          className="ui-td px-2 py-2 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 border-t border-slate-200 dark:border-slate-600"
                        >
                          {group.label}
                          <span className="ml-2 font-normal tabular-nums text-slate-500 dark:text-slate-400">
                            {t("admin.boardIssueStats.group.boardCount", { n: group.rows.length })}{" "}
                            {t("admin.boardIssueStats.group.issueSum", {
                              n: group.rows.reduce((s, r) => s + r.issueCount, 0).toLocaleString(),
                            })}
                            {payload?.listBasedIncluded
                              ? ` ${t("admin.boardIssueStats.group.listSum", {
                                  n: group.rows
                                    .reduce((s, r) => s + (finiteListBasedCount(r) ?? 0), 0)
                                    .toLocaleString(),
                                })}`
                              : ""}
                          </span>
                        </td>
                      </tr>
                      {group.rows.map((row) => {
                        const listN = finiteListBasedCount(row);
                        return (
                          <tr key={row.id}>
                            <td className="ui-td font-medium text-slate-900 dark:text-slate-100">
                              <span className="line-clamp-2" title={row.name}>
                                {row.name}
                              </span>
                              <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-slate-500 dark:text-slate-400">
                                ID {row.id}
                              </span>
                            </td>
                            <td className="ui-td text-slate-700 dark:text-slate-200">
                              {formatCafeGame(row.cafeGame, crawlerLookups.labelByCode)}
                            </td>
                            <td className="ui-td text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                              {row.issueCount.toLocaleString()}
                            </td>
                            <td
                              className="ui-td text-right tabular-nums text-slate-800 dark:text-slate-100"
                              title={
                                row.listBasedError
                                  ? row.listBasedError
                                  : row.listBasedSkipped === "no_cafe_url"
                                    ? t("admin.boardIssueStats.listCell.noCafeUrl")
                                    : row.listBasedFromDb
                                      ? t("admin.boardIssueStats.listCell.fromDb")
                                      : undefined
                              }
                            >
                              {payload?.listBasedIncluded ? (
                                listN !== undefined ? (
                                  listN.toLocaleString()
                                ) : row.listBasedError ? (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    {t("admin.boardIssueStats.errorShort")}
                                  </span>
                                ) : (
                                  "—"
                                )
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="ui-td">
                              {(row.listUrl || row.url) && (
                                <a
                                  href={monitoredBoardListHref(row.listUrl || row.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ui-btn ui-btn-ghost ui-btn-sm px-0 !min-h-0 !min-w-0 text-xs"
                                >
                                  {t("admin.boardIssueStats.openList")}
                                </a>
                              )}
                              {!row.listUrl && !row.url && <span className="text-slate-400">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
