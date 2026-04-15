import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import {
  kstCalendarDateString,
  kstInclusiveDateRange,
  formatClanIssueListDate,
} from "../../utils/formatters";
import { Button } from "../../components/ui/Button";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface CardExchangeIssue {
  id: string;
  summary: string;
  detail: string;
  date: string;
  sourceCreatedAt?: string;
  sourceUrl?: string;
  monitoredBoard?: {
    id: number;
    name: string;
    cafeGame: string;
  };
  createdAt: string;
}

interface CardExchangeIssuesResponse {
  issues: CardExchangeIssue[];
  total: number;
  limit: number | null;
  offset: number;
}

interface CardExchangeDailyIngestResponse {
  days: { date: string; count: number }[];
  total: number;
  startDate: string;
  endDate: string;
}

export default function CardExchangeManagement() {
  const { t } = useTranslation("pagesAdmin");
  const { token, selectedProjectId } = useAuth();
  const [issues, setIssues] = useState<CardExchangeIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rangeDailyRows, setRangeDailyRows] = useState<{ date: string; count: number }[]>([]);
  const [rangeIngestTotal, setRangeIngestTotal] = useState<number | null>(null);
  const [rangeStatsLoading, setRangeStatsLoading] = useState(true);

  /** 접속 시 기본: KST 당일 1일치만 조회 */
  const [startDate, setStartDate] = useState<string>(() => kstCalendarDateString());
  const [endDate, setEndDate] = useState<string>(() => kstCalendarDateString());
  const [currentPage, setCurrentPage] = useState(1);

  const itemsPerPage = 100;
  const authHeaders = useMemo(() => createAuthHeaders(token) ?? {}, [token]);

  useEffect(() => {
    loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, currentPage, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    const fetchRangeStats = async () => {
      if (!startDate || !endDate) {
        setRangeDailyRows([]);
        setRangeIngestTotal(null);
        setRangeStatsLoading(false);
        return;
      }

      setRangeStatsLoading(true);

      const dailyParams = new URLSearchParams();
      dailyParams.append("startDate", startDate);
      dailyParams.append("endDate", endDate);
      if (selectedProjectId != null) {
        dailyParams.append("projectId", String(selectedProjectId));
      }

      try {
        const dailyRes = await fetch(`/api/issues/card-exchange/daily-counts?${dailyParams.toString()}`, {
          headers: authHeaders,
          signal: AbortSignal.timeout(15000),
        });

        if (cancelled) return;

        if (dailyRes.ok) {
          const body = await dailyRes.json();
          const data: CardExchangeDailyIngestResponse = body.data || body;
          const byDay = new Map((data.days || []).map((d) => [d.date, d.count]));
          const days = kstInclusiveDateRange(startDate, endDate);
          const rows = days.map((date) => ({ date, count: byDay.get(date) ?? 0 }));
          setRangeDailyRows(rows);
          setRangeIngestTotal(rows.reduce((s, r) => s + r.count, 0));
        } else {
          setRangeDailyRows([]);
          setRangeIngestTotal(null);
        }
      } catch {
        if (!cancelled) {
          setRangeDailyRows([]);
          setRangeIngestTotal(null);
        }
      } finally {
        if (!cancelled) setRangeStatsLoading(false);
      }
    };
    void fetchRangeStats();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, selectedProjectId, authHeaders]);

  async function loadIssues() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) {
        params.append("startDate", startDate);
      }
      if (endDate) {
        params.append("endDate", endDate);
      }
      params.append("limit", itemsPerPage.toString());
      params.append("offset", ((currentPage - 1) * itemsPerPage).toString());
      if (selectedProjectId != null) {
        params.append("projectId", String(selectedProjectId));
      }

      const url = `/api/issues/card-exchange?${params.toString()}`;
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const data: CardExchangeIssuesResponse = body.data || body;
      setIssues(data.issues || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message || t("admin.cardExchange.errors.loadFailed"));
      console.error("Failed to load card exchange issues:", err);
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.ceil(total / itemsPerPage);

  const handleDateFilter = () => {
    setCurrentPage(1);
    loadIssues();
  };

  const handleResetDates = () => {
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  return (
    <div className="ui-page">
      <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">{t("admin.cardExchange.title")}</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed max-w-5xl">
            {t("admin.cardExchange.subtitle")}
          </p>
        </div>

        <div className="ui-card ui-card-pad mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
                <label htmlFor="card-exchange-start" className="ui-label">
                  {t("admin.cardExchange.startDate")}
                </label>
                <LocalizedDateInput
                  id="card-exchange-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="ui-input"
                />
              </div>
              <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
                <label htmlFor="card-exchange-end" className="ui-label">
                  {t("admin.cardExchange.endDate")}
                </label>
                <LocalizedDateInput
                  id="card-exchange-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="ui-input"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleDateFilter} variant="primary" className="min-w-[6.5rem] justify-center">
                  {t("admin.cardExchange.applyFilter")}
                </Button>
                <Button onClick={handleResetDates} variant="outline" className="min-w-[6rem] justify-center">
                  {t("admin.cardExchange.reset")}
                </Button>
              </div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t("admin.cardExchange.perPage", { n: itemsPerPage })} ·{" "}
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {t("admin.cardExchange.totalCount", { n: total })}
              </span>
            </div>
          </div>
        </div>

        {/* 일별 표 + 요약 카드: 넓은 화면에서 가로 배치 */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <div className="ui-card overflow-hidden flex-1 min-w-0">
              <div className="border-b border-slate-200/80 dark:border-slate-700/80 px-5 py-4 bg-slate-50/80 dark:bg-slate-900/40">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("admin.cardExchange.dailyTitle")}</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">
                  <strong className="font-medium text-slate-600 dark:text-slate-300">
                    {t("admin.cardExchange.dailyHint1Strong")}
                  </strong>
                  {t("admin.cardExchange.dailyHint1Rest")} {t("admin.cardExchange.dailyHint2")}
                </p>
              </div>
              <div className="p-4 sm:p-5">
                <div className="mb-4">
                  {rangeDailyRows.length === 0 ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {rangeStatsLoading ? t("admin.cardExchange.graphLoading") : t("admin.cardExchange.graphFailed")}
                    </div>
                  ) : (
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rangeDailyRows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
                          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v) => String(v).slice(5)} />
                          <YAxis tick={{ fontSize: 12 }} width={36} />
                          <Tooltip
                            formatter={(value: any, name: any) => {
                              const label = name === "count" ? t("admin.cardExchange.table.count") : String(name || "");
                              return [Number(value).toLocaleString(), label];
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="count"
                            name="count"
                            stroke="#f59e0b"
                            strokeWidth={2.5}
                            dot={{ r: 2 }}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              <table className="ui-table w-full max-w-xl lg:max-w-none">
                <thead>
                  <tr>
                    <th className="ui-th text-left">{t("admin.cardExchange.table.dateIngestKst")}</th>
                    <th className="ui-th text-right w-28">{t("admin.cardExchange.table.count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeDailyRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="ui-td text-center text-slate-500 dark:text-slate-400 text-sm py-6">
                        {rangeStatsLoading ? t("admin.cardExchange.loading") : t("admin.cardExchange.graphFailed")}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {rangeDailyRows.map((row) => {
                        return (
                        <tr key={row.date}>
                          <td className="ui-td tabular-nums text-slate-700 dark:text-slate-200">
                            {row.date}
                          </td>
                          <td className="ui-td text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
                            {row.count.toLocaleString()}
                          </td>
                        </tr>
                        );
                      })}
                      <tr className="bg-amber-50/60 dark:bg-amber-950/25">
                        <td className="ui-td font-semibold text-slate-800 dark:text-slate-100">{t("admin.cardExchange.table.totalIngest")}</td>
                        <td className="ui-td text-right tabular-nums font-bold text-amber-950 dark:text-amber-100">
                          {(rangeIngestTotal ?? rangeDailyRows.reduce((s, r) => s + r.count, 0)).toLocaleString()}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
              </div>
            </div>

            <div className="flex flex-col gap-4 w-full lg:w-80 lg:flex-shrink-0">
              <div className="ui-card p-5 flex-1">
                <div className="text-sm text-slate-600 dark:text-slate-400">{t("admin.cardExchange.table.filteredTotal")}</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{total}</div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.cardExchange.table.filteredTotalHint")}
                </p>
              </div>
              <div className="ui-card p-5 flex-1 border-amber-200/80 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20">
                <div className="text-sm text-slate-600 dark:text-slate-400">{t("admin.cardExchange.table.selectedTotal")}</div>
                <div className="text-2xl font-bold text-amber-950 dark:text-amber-100 tabular-nums">
                  {rangeIngestTotal === null ? "—" : rangeIngestTotal.toLocaleString()}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {startDate && endDate ? `${startDate} ~ ${endDate}` : "—"}
                </p>
              </div>
            </div>
          </div>

        {error && (
          <div className="ui-alert ui-alert-danger mb-4">
            <div className="ui-alert-body">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="ui-card ui-card-pad text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="mt-2 text-slate-600 dark:text-slate-400">{t("admin.cardExchange.loading")}</p>
          </div>
        ) : issues.length === 0 ? (
          <div className="ui-card ui-card-pad text-center py-12">
            <p className="text-slate-600 dark:text-slate-400">{t("admin.cardExchange.empty")}</p>
          </div>
        ) : (
          <>
            <div className="ui-card overflow-hidden">
              <div className="overflow-x-auto">
                <div className="mx-auto w-full max-w-7xl">
                  <table className="ui-table w-full table-fixed">
                    <colgroup>
                      <col style={{ width: "10rem" }} />
                      <col />
                      <col style={{ width: "14rem" }} />
                      <col style={{ width: "8rem" }} />
                    </colgroup>
                  <thead>
                    <tr>
                      <th className="ui-th w-32 text-center">{t("admin.cardExchange.issueTable.date")}</th>
                      <th className="ui-th">{t("admin.cardExchange.issueTable.title")}</th>
                      <th className="ui-th w-44">{t("admin.cardExchange.issueTable.board")}</th>
                      <th className="ui-th w-28">{t("admin.cardExchange.issueTable.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((issue) => (
                      <tr key={issue.id}>
                        <td className="ui-td align-top whitespace-nowrap text-slate-600 dark:text-slate-400 text-center tabular-nums px-4">
                          {formatClanIssueListDate({
                            date: issue.date,
                            sourceCreatedAt: issue.sourceCreatedAt,
                            createdAt: issue.createdAt,
                          })}
                        </td>
                        <td className="ui-td align-top">
                          <div
                            className="font-medium text-slate-900 dark:text-slate-100"
                            title={issue.summary || t("admin.cardExchange.issueTable.noTitle")}
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {issue.summary || t("admin.cardExchange.issueTable.noTitle")}
                          </div>
                        </td>
                        <td className="ui-td align-top text-slate-600 dark:text-slate-400">{issue.monitoredBoard?.name || "-"}</td>
                        <td className="ui-td align-top">
                          {issue.sourceUrl && (
                            <a
                              href={issue.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn ui-btn-ghost ui-btn-sm px-0 !min-h-0 !min-w-0"
                            >
                              {t("admin.cardExchange.issueTable.openOriginal")}
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="ui-card ui-card-pad mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} variant="outline" size="sm" className="min-w-[4.5rem] justify-center">
                    {t("admin.cardExchange.pagination.prev")}
                  </Button>
                  <span className="px-2 py-1 text-sm text-slate-700 dark:text-slate-300 tabular-nums text-center">
                    {currentPage} / {totalPages}
                    <span className="block sm:inline sm:ml-1 text-xs text-slate-500 dark:text-slate-400">
                      {t("admin.cardExchange.pagination.totalHint", { n: total })}
                    </span>
                  </span>
                  <Button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} variant="outline" size="sm" className="min-w-[4.5rem] justify-center">
                    {t("admin.cardExchange.pagination.next")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

