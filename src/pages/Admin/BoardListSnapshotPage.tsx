import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { kstCalendarDateString } from "../../utils/formatters";
import { Button } from "../../components/ui/Button";
import { useCrawlerGames } from "../../hooks/useCrawlerGames";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

type SnapshotRow = {
  monitoredBoardId: number;
  boardName: string;
  cafeGame: string | null;
  projectId: number | null;
  dateKst: string;
  postCount: number;
  scanTotalRows: number | null;
  maxPagesUsed: number | null;
  computedAt: string;
};

type SnapshotPayload = {
  datesInRange: string[];
  rows: SnapshotRow[];
};

interface BoardOpt {
  id: number;
  name: string;
  cafeGame: string | null;
  projectId: number | null;
}

type BoardMatrixRow = {
  id: number;
  name: string;
  cells: (SnapshotRow | null)[];
  rowSum: number;
};

function goTo(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatCafeGame(cafeGame: string | null, labelByCode: Record<string, string>): string {
  if (!cafeGame) return "—";
  return labelByCode[cafeGame] ?? cafeGame;
}

export default function BoardListSnapshotPage() {
  const { t } = useTranslation("pagesAdmin");
  const { token, selectedProjectId, user } = useAuth();
  const { lookups: crawlerLookups } = useCrawlerGames(token);
  const [startDate, setStartDate] = useState(() => kstCalendarDateString());
  const [endDate, setEndDate] = useState(() => kstCalendarDateString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SnapshotPayload | null>(null);
  const [boardOptions, setBoardOptions] = useState<BoardOpt[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [selectedBoardIds, setSelectedBoardIds] = useState<number[] | null>(null);

  const authHeaders = useMemo(() => createAuthHeaders(token) ?? {}, [token]);
  const isAdmin = user?.role === "ADMIN";

  const boardsInProject = useMemo(() => {
    if (selectedProjectId == null) return boardOptions;
    return boardOptions.filter((b) => b.projectId === selectedProjectId);
  }, [boardOptions, selectedProjectId]);

  const allBoardIds = useMemo(() => boardsInProject.map((b) => b.id), [boardsInProject]);

  useEffect(() => {
    if (!token) return;
    setBoardsLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/monitoring/boards?isActive=true&enabled=true", { headers: authHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const raw = body.data ?? body ?? [];
        const boards: BoardOpt[] = raw.map((b: Record<string, unknown>) => ({
          id: Number(b.id),
          name: String(b.name || b.label || "").trim(),
          cafeGame: (b.cafeGame as string | null) ?? null,
          projectId: b.projectId != null ? Number(b.projectId) : null,
        }));
        setBoardOptions(boards.filter((b) => !Number.isNaN(b.id) && b.name));
      } catch {
        setBoardOptions([]);
      } finally {
        setBoardsLoading(false);
      }
    })();
  }, [token, authHeaders]);

  const isBoardSelected = useCallback(
    (id: number) => (selectedBoardIds == null ? true : selectedBoardIds.includes(id)),
    [selectedBoardIds]
  );

  const toggleBoard = useCallback(
    (id: number) => {
      if (allBoardIds.length === 0) return;
      setSelectedBoardIds((prev) => {
        const current = prev == null ? [...allBoardIds] : prev;
        const set = new Set(current);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        const next = Array.from(set);
        return next.length === allBoardIds.length ? null : next;
      });
    },
    [allBoardIds]
  );

  const loadSnapshots = useCallback(async () => {
    if (!startDate || !endDate) {
      setError(t("admin.boardListSnapshot.errors.needDates"));
      return;
    }
    const ids = selectedBoardIds == null ? allBoardIds : selectedBoardIds;
    if (ids.length === 0) {
      setError(t("admin.boardListSnapshot.errors.needBoard"));
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      if (selectedProjectId != null) params.set("projectId", String(selectedProjectId));
      params.set("boardIds", ids.join(","));
      const res = await fetch(`/api/monitoring/board-list-daily-snapshots?${params.toString()}`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b.message || b.error || `HTTP ${res.status}`) as string);
      }
      const body = await res.json();
      const data = (body.data ?? body) as SnapshotPayload;
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : t("admin.boardListSnapshot.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedProjectId, selectedBoardIds, allBoardIds, authHeaders, t]);

  const matrix = useMemo(() => {
    if (!payload?.datesInRange?.length) {
      return { boardRows: [] as BoardMatrixRow[], colTotals: [] as number[], dates: [] as string[] };
    }
    const dates = payload.datesInRange;
    const ids = selectedBoardIds == null ? allBoardIds : selectedBoardIds;
    const idSet = new Set(ids);
    const snapByBoardDate = new Map<string, SnapshotRow>();
    for (const r of payload.rows) {
      if (!idSet.has(r.monitoredBoardId)) continue;
      snapByBoardDate.set(`${r.monitoredBoardId}:${r.dateKst}`, r);
    }

    const boardMeta = new Map<number, { name: string; cafeGame: string | null }>();
    for (const b of boardsInProject) {
      if (idSet.has(b.id)) boardMeta.set(b.id, { name: b.name, cafeGame: b.cafeGame });
    }
    for (const r of payload.rows) {
      if (idSet.has(r.monitoredBoardId) && !boardMeta.has(r.monitoredBoardId)) {
        boardMeta.set(r.monitoredBoardId, { name: r.boardName, cafeGame: r.cafeGame });
      }
    }

    const boardRows: BoardMatrixRow[] = ids.map((bid) => {
      const meta = boardMeta.get(bid) || { name: `#${bid}`, cafeGame: null as string | null };
      const cells = dates.map((d) => snapByBoardDate.get(`${bid}:${d}`) ?? null);
      const rowSum = cells.reduce((s, c) => s + (c ? c.postCount : 0), 0);
      return { id: bid, name: meta.name, cells, rowSum };
    });

    const colTotals = dates.map((_, i) => boardRows.reduce((s, br) => s + (br.cells[i]?.postCount ?? 0), 0));

    return { boardRows, colTotals, dates };
  }, [payload, boardsInProject, allBoardIds, selectedBoardIds]);

  const grandTotal = useMemo(() => matrix.colTotals.reduce((s, n) => s + n, 0), [matrix.colTotals]);

  return (
    <div className="ui-page">
      <div className="mx-auto max-w-[1900px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {t("admin.boardListSnapshot.title")}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t("admin.boardListSnapshot.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => goTo("/board-issue-stats")}
            className="text-left text-sm font-medium text-blue-600 hover:underline"
          >
            {t("admin.boardListSnapshot.backToStats")}
          </button>
        </div>

        <div className="ui-card ui-card-pad mb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
              <label className="ui-label" htmlFor="snap-start">
                {t("admin.boardListSnapshot.startDate")}
              </label>
              <LocalizedDateInput
                id="snap-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="ui-input"
              />
            </div>
            <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
              <label className="ui-label" htmlFor="snap-end">
                {t("admin.boardListSnapshot.endDate")}
              </label>
              <LocalizedDateInput
                id="snap-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="ui-input"
              />
            </div>
            <Button type="button" variant="primary" onClick={() => void loadSnapshots()} className="min-w-[6rem] justify-center">
              {loading ? t("admin.boardListSnapshot.querying") : t("admin.boardListSnapshot.query")}
            </Button>
          </div>
          {selectedProjectId != null ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t("admin.boardListSnapshot.projectFilterHint")}
            </p>
          ) : (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-200/90">
              {t("admin.boardListSnapshot.noProjectWarning")}
            </p>
          )}
        </div>

        {isAdmin ? (
          <details className="ui-card ui-card-pad mb-6 bg-slate-50/40 dark:bg-slate-900/30" open>
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-700 dark:text-slate-200">
              {t("admin.boardListSnapshot.selectBoards")}{" "}
              {boardsLoading
                ? t("admin.boardListSnapshot.selectBoardsLoading")
                : t("admin.boardListSnapshot.selectBoardsCount", { n: boardsInProject.length })}
            </summary>
            <div className="mt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={selectedBoardIds == null}
                  onChange={() => setSelectedBoardIds(null)}
                  className="rounded border-slate-300"
                  disabled={boardsLoading || boardsInProject.length === 0}
                />
                {t("admin.boardListSnapshot.all")}
              </label>
              <div className="mt-2 max-h-[220px] overflow-auto rounded border border-slate-200 bg-white/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                {boardsInProject.map((b) => (
                  <label key={b.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={isBoardSelected(b.id)}
                      onChange={() => toggleBoard(b.id)}
                      className="rounded border-slate-300"
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
            </div>
          </details>
        ) : (
          <p className="mb-6 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.boardListSnapshot.adminOnlyBoardSelect")}
          </p>
        )}

        {error ? (
          <div className="ui-alert ui-alert-danger mb-4">
            <div className="ui-alert-body">{error}</div>
          </div>
        ) : null}

        {payload && matrix.dates.length > 0 ? (
          <div className="ui-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="ui-table w-full min-w-[640px] text-sm">
                <thead>
                  <tr>
                    <th className="ui-th sticky left-0 z-10 min-w-[12rem] bg-slate-100 text-left dark:bg-slate-800">
                      {t("admin.boardListSnapshot.table.board")}
                    </th>
                    {matrix.dates.map((d) => (
                      <th key={d} className="ui-th whitespace-nowrap px-2 text-right tabular-nums">
                        {d.slice(5)}
                      </th>
                    ))}
                    <th className="ui-th text-right tabular-nums">
                      {t("admin.boardListSnapshot.table.total")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.boardRows.map((br) => (
                    <tr key={br.id}>
                      <td className="ui-td sticky left-0 z-10 bg-white font-medium dark:bg-slate-900">
                        <div className="max-w-[14rem] truncate" title={br.name}>
                          {br.name}
                        </div>
                        <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">ID {br.id}</div>
                      </td>
                      {br.cells.map((c, i) => (
                        <td
                          key={matrix.dates[i]}
                          className="ui-td px-2 text-right tabular-nums text-slate-800 dark:text-slate-200"
                        >
                          {c ? (
                            <span
                              title={
                                c.computedAt
                                  ? t("admin.boardListSnapshot.cellTitle", {
                                      at: c.computedAt,
                                      pagesPart:
                                        c.maxPagesUsed != null
                                          ? t("admin.boardListSnapshot.cellTitlePages", { n: c.maxPagesUsed })
                                          : "",
                                    })
                                  : undefined
                              }
                            >
                              {c.postCount.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </td>
                      ))}
                      <td className="ui-td text-right font-semibold tabular-nums">{br.rowSum.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 dark:bg-slate-800/60">
                    <td className="ui-td sticky left-0 z-10 bg-slate-50 font-semibold dark:bg-slate-800">
                      {t("admin.boardListSnapshot.colTotals")}
                    </td>
                    {matrix.colTotals.map((n, i) => (
                      <td key={matrix.dates[i]} className="ui-td px-2 text-right font-semibold tabular-nums">
                        {n.toLocaleString()}
                      </td>
                    ))}
                    <td className="ui-td text-right font-bold tabular-nums">{grandTotal.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t("admin.boardListSnapshot.footer")}
            </div>
          </div>
        ) : null}

        {payload && matrix.dates.length === 0 ? (
          <div className="ui-card ui-card-pad text-center text-slate-500 dark:text-slate-400">
            {t("admin.boardListSnapshot.emptyNoDates")}
          </div>
        ) : null}

        {!loading && !payload && !error ? (
          <div className="ui-card ui-card-pad text-center text-slate-500 dark:text-slate-400">
            {t("admin.boardListSnapshot.emptyPrompt")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
