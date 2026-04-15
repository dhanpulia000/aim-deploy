import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { useCrawlerGames } from "../../hooks/useCrawlerGames";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

interface GameVolumeRow {
  period: string;
  pubgPc: number;
  pubgMobile: number;
  clanPosts: number;
  cardExchangePosts: number;
}

function gameVolumeLineTotal(
  row: Pick<GameVolumeRow, 'pubgPc' | 'pubgMobile' | 'clanPosts' | 'cardExchangePosts'>
) {
  return (
    (Number(row.pubgPc) || 0) +
    (Number(row.pubgMobile) || 0) +
    (Number(row.clanPosts) || 0) +
    (Number(row.cardExchangePosts) || 0)
  );
}

function normalizeVolumeRow(raw: Partial<GameVolumeRow> & { period: string }): GameVolumeRow {
  return {
    period: raw.period,
    pubgPc: Number(raw.pubgPc) || 0,
    pubgMobile: Number(raw.pubgMobile) || 0,
    clanPosts: Number(raw.clanPosts) || 0,
    cardExchangePosts: Number(raw.cardExchangePosts) || 0,
  };
}

interface AgentOption {
  id: string;
  name: string;
  email?: string | null;
}

interface AgentStat {
  agentId: string;
  agentName: string;
  agentEmail: string;
  totalProcessed: number;
  severityBreakdown: {
    sev1: number;
    sev2: number;
    sev3: number;
  };
  sentimentBreakdown: {
    pos: number;
    neg: number;
    neu: number;
  };
  statusBreakdown: {
    resolved: number;
    inProgress: number;
    triaged: number;
    open: number;
  };
  avgHandleTime: number | null;
  medianHandleTime: number | null;
  fastestHandleTime: number | null;
  slowestHandleTime: number | null;
  categoryBreakdown: Array<{
    categoryGroup: string;
    category: string;
    count: number;
  }>;
  projectBreakdown: Array<{
    projectName: string;
    count: number;
  }>;
  dailyStats: Array<{
    date: string;
    count: number;
    avgTime: number | null;
  }>;
}

export default function AgentPerformance() {
  const { t } = useTranslation("pagesAdmin");
  const { token } = useAuth();
  const { lookups: crawlerVolLookups } = useCrawlerGames(token);
  const volumeColPc =
    crawlerVolLookups.labelByCode["PUBG_PC"] ?? "PUBG_PC";
  const volumeColMo =
    crawlerVolLookups.labelByCode["PUBG_MOBILE"] ?? "PUBG_MOBILE";
  const [stats, setStats] = useState<AgentStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 필터 상태
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7); // 기본: 최근 7일
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  
  const [exporting, setExporting] = useState(false);
  const [volumePeriod, setVolumePeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [volumeRows, setVolumeRows] = useState<GameVolumeRow[]>([]);
  /** KST 일자 단위 (주간/월간 보기에서도 API가 함께 내려줌) */
  const [volumeDailyRows, setVolumeDailyRows] = useState<GameVolumeRow[]>([]);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [exportingVolume, setExportingVolume] = useState(false);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);

  const authHeaders = useMemo(() => createAuthHeaders(token) ?? {}, [token]);

  const volumeTotals = useMemo(() => {
    return volumeRows.reduce(
      (acc, row) => ({
        pubgPc: acc.pubgPc + (Number(row.pubgPc) || 0),
        pubgMobile: acc.pubgMobile + (Number(row.pubgMobile) || 0),
        clanPosts: acc.clanPosts + (Number(row.clanPosts) || 0),
        cardExchangePosts: acc.cardExchangePosts + (Number(row.cardExchangePosts) || 0),
      }),
      { pubgPc: 0, pubgMobile: 0, clanPosts: 0, cardExchangePosts: 0 }
    );
  }, [volumeRows]);

  const volumeGrandTotal =
    volumeTotals.pubgPc +
    volumeTotals.pubgMobile +
    volumeTotals.clanPosts +
    volumeTotals.cardExchangePosts;

  const dailyVolumeTotals = useMemo(() => {
    return volumeDailyRows.reduce(
      (acc, row) => ({
        pubgPc: acc.pubgPc + (Number(row.pubgPc) || 0),
        pubgMobile: acc.pubgMobile + (Number(row.pubgMobile) || 0),
        clanPosts: acc.clanPosts + (Number(row.clanPosts) || 0),
        cardExchangePosts: acc.cardExchangePosts + (Number(row.cardExchangePosts) || 0),
      }),
      { pubgPc: 0, pubgMobile: 0, clanPosts: 0, cardExchangePosts: 0 }
    );
  }, [volumeDailyRows]);

  const dailyVolumeGrandTotal =
    dailyVolumeTotals.pubgPc +
    dailyVolumeTotals.pubgMobile +
    dailyVolumeTotals.clanPosts +
    dailyVolumeTotals.cardExchangePosts;

  const volumeBucketSumLabel =
    volumePeriod === 'daily'
      ? t("admin.agentPerformance.periodSumLabel.daily")
      : volumePeriod === 'weekly'
        ? t("admin.agentPerformance.periodSumLabel.weekly")
        : t("admin.agentPerformance.periodSumLabel.monthly");

  useEffect(() => {
    loadStats();
  }, [startDate, endDate, selectedAgentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agents', { headers: authHeaders });
        if (!res.ok) return;
        const body = await res.json();
        const list = body.data ?? body;
        if (!cancelled && Array.isArray(list)) {
          setAgentOptions(
            list.map((a: { id: string; name: string; email?: string }) => ({
              id: a.id,
              name: a.name,
              email: a.email
            }))
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  useEffect(() => {
    loadGameVolume();
  }, [startDate, endDate, volumePeriod, authHeaders]);

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (selectedAgentId) params.set('agentId', selectedAgentId);
      
      const url = `/api/agent-stats?${params.toString()}`;
      const res = await fetch(url, { headers: authHeaders });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const body = await res.json();
      const data = body.data || body;
      setStats(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || t("admin.agentPerformance.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadGameVolume() {
    setVolumeLoading(true);
    setVolumeError(null);
    try {
      const params = new URLSearchParams();
      params.set('period', volumePeriod);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await fetch(`/api/agent-stats/game-volume?${params}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const pack = body.data ?? body;
      setVolumeRows(
        Array.isArray(pack.rows) ? pack.rows.map((r: Partial<GameVolumeRow> & { period: string }) => normalizeVolumeRow(r)) : []
      );
      const dr = Array.isArray(pack.dailyRows) ? pack.dailyRows : [];
      setVolumeDailyRows(dr.map((r: Partial<GameVolumeRow> & { period: string }) => normalizeVolumeRow(r)));
    } catch (err: unknown) {
      setVolumeError(err instanceof Error ? err.message : t("admin.agentPerformance.errors.volumeLoadFailed"));
      setVolumeRows([]);
      setVolumeDailyRows([]);
    } finally {
      setVolumeLoading(false);
    }
  }

  async function handleExportGameVolume() {
    setExportingVolume(true);
    try {
      const params = new URLSearchParams();
      params.set('period', volumePeriod);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const url = `/api/agent-stats/game-volume/export?${params}`;
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `game-clan-volume-${volumePeriod}-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t("admin.agentPerformance.errors.downloadFailed"));
    } finally {
      setExportingVolume(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (selectedAgentId) params.set('agentId', selectedAgentId);
      
      const url = `/api/agent-stats/export?${params.toString()}`;
      const res = await fetch(url, { headers: authHeaders });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      // 파일 다운로드
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `agent-stats-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      alert(t("admin.agentPerformance.errors.excelDownloaded"));
    } catch (err: any) {
      alert(err.message || t("admin.agentPerformance.errors.reportFailed"));
    } finally {
      setExporting(false);
    }
  }

  // 시간 포맷 (초 → 읽기 쉬운 형식)
  function formatTime(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return '-';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return t("admin.agentPerformance.time.hm", { h: hours, m: minutes });
    } else if (minutes > 0) {
      return t("admin.agentPerformance.time.ms", { m: minutes, s: secs });
    } else {
      return t("admin.agentPerformance.time.s", { s: secs });
    }
  }

  // 전체 통계 (모든 에이전트 합계)
  const totalStats = useMemo(() => {
    if (stats.length === 0) return null;
    
    return {
      totalProcessed: stats.reduce((sum, s) => sum + s.totalProcessed, 0),
      totalSev1: stats.reduce((sum, s) => sum + s.severityBreakdown.sev1, 0),
      totalSev2: stats.reduce((sum, s) => sum + s.severityBreakdown.sev2, 0),
      totalSev3: stats.reduce((sum, s) => sum + s.severityBreakdown.sev3, 0),
      totalPos: stats.reduce((sum, s) => sum + s.sentimentBreakdown.pos, 0),
      totalNeg: stats.reduce((sum, s) => sum + s.sentimentBreakdown.neg, 0),
      totalNeu: stats.reduce((sum, s) => sum + s.sentimentBreakdown.neu, 0),
      avgHandleTime: stats.filter(s => s.avgHandleTime !== null).length > 0
        ? Math.round(
            stats.reduce((sum, s) => sum + (s.avgHandleTime || 0), 0) / 
            stats.filter(s => s.avgHandleTime !== null).length
          )
        : null
    };
  }, [stats]);

  return (
    <div className="space-y-6">
      {/* 헤더 및 필터 */}
      <div className="bg-white border rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{t("admin.agentPerformance.title")}</h2>
            <p className="text-sm text-slate-500 mt-1">{t("admin.agentPerformance.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => loadStats()}
              className="px-3 py-1.5 rounded-lg border text-sm text-slate-600 hover:bg-slate-50"
            >
              {t("admin.agentPerformance.refresh")}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || stats.length === 0}
              className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {exporting ? t("admin.agentPerformance.generating") : t("admin.agentPerformance.excelDownload")}
            </button>
          </div>
        </div>

        {/* 필터 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("admin.agentPerformance.filters.startDate")}</label>
            <LocalizedDateInput
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("admin.agentPerformance.filters.endDate")}</label>
            <LocalizedDateInput
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("admin.agentPerformance.filters.agent")}</label>
            <select
              value={selectedAgentId || ''}
              onChange={(e) => setSelectedAgentId(e.target.value || null)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">{t("admin.agentPerformance.filters.allAgents")}</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.email || a.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 수집 채널(레거시 코드)·클랜·카드 교환 유입 (일/주/월) */}
      <div className="bg-white border rounded-2xl shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{t("admin.agentPerformance.volume.title")}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {t("admin.agentPerformance.volume.hintPrefix")}
              <strong className="font-medium text-slate-600">{t("admin.agentPerformance.volume.hintStrong1")}</strong>
              {t("admin.agentPerformance.volume.hintMid")}{" "}
              <strong className="font-medium text-slate-600">{t("admin.agentPerformance.volume.hintStrong2")}</strong>
              {t("admin.agentPerformance.volume.hintSuffix")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['daily', 'weekly', 'monthly'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setVolumePeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  volumePeriod === p
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {p === "daily"
                  ? t("admin.agentPerformance.volume.period.daily")
                  : p === "weekly"
                    ? t("admin.agentPerformance.volume.period.weekly")
                    : t("admin.agentPerformance.volume.period.monthly")}
              </button>
            ))}
            <button
              type="button"
              onClick={() => loadGameVolume()}
              className="px-3 py-1.5 rounded-lg border text-sm text-slate-600 hover:bg-slate-50"
            >
              {t("admin.agentPerformance.refresh")}
            </button>
            <button
              type="button"
              onClick={handleExportGameVolume}
              disabled={exportingVolume}
              className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm hover:bg-teal-700 disabled:opacity-50"
            >
              {exportingVolume ? t("admin.agentPerformance.generating") : t("admin.agentPerformance.volume.excel")}
            </button>
          </div>
        </div>
        {volumeLoading && <div className="text-slate-500 text-sm py-4">{t("admin.agentPerformance.volume.loading")}</div>}
        {volumeError && <div className="text-red-500 text-sm py-2">{volumeError}</div>}
        {!volumeLoading && !volumeError && volumeRows.length > 0 && (
          <>
            <p className="text-xs text-slate-500 mb-2">
              <span className="font-medium text-slate-600">{volumeBucketSumLabel}</span>
              {t("admin.agentPerformance.volume.dailyDetailExplain")}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">{volumeColPc} · {volumeBucketSumLabel}</div>
                <div className="text-xl font-semibold tabular-nums text-slate-900 mt-0.5">
                  {volumeTotals.pubgPc.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">{volumeColMo} · {volumeBucketSumLabel}</div>
                <div className="text-xl font-semibold tabular-nums text-slate-900 mt-0.5">
                  {volumeTotals.pubgMobile.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-3">
                <div className="text-xs font-medium text-teal-800/90">
                  {t("admin.agentPerformance.volume.bucket.clan", { label: volumeBucketSumLabel })}
                </div>
                <div className="text-xl font-semibold tabular-nums text-teal-900 mt-0.5">
                  {volumeTotals.clanPosts.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3">
                <div className="text-xs font-medium text-amber-900/85">
                  {t("admin.agentPerformance.volume.bucket.cardExchange", { label: volumeBucketSumLabel })}
                </div>
                <div className="text-xl font-semibold tabular-nums text-amber-950 mt-0.5">
                  {volumeTotals.cardExchangePosts.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl border border-teal-200 bg-teal-700/5 px-4 py-3">
                <div className="text-xs font-medium text-teal-900/80">
                  {t("admin.agentPerformance.volume.bucket.total", { label: volumeBucketSumLabel })}
                </div>
                <div className="text-xl font-bold tabular-nums text-teal-800 mt-0.5">
                  {volumeGrandTotal.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-600">
                    <th className="px-3 py-2 font-medium">{t("admin.agentPerformance.volume.table.period")}</th>
                    <th className="px-3 py-2 font-medium text-right">{volumeColPc}</th>
                    <th className="px-3 py-2 font-medium text-right">{volumeColMo}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("admin.agentPerformance.volume.table.clan")}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("admin.agentPerformance.volume.table.cardExchange")}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("admin.agentPerformance.volume.table.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {volumeRows.map((row) => (
                    <tr key={row.period} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2 font-mono text-slate-800">{row.period}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.pubgPc.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.pubgMobile.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-teal-800">{row.clanPosts.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-900">{row.cardExchangePosts.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                        {gameVolumeLineTotal(row).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-teal-50/90 border-t-2 border-teal-200/80 font-semibold text-slate-800">
                    <td className="px-3 py-2.5">{volumeBucketSumLabel}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{volumeTotals.pubgPc.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{volumeTotals.pubgMobile.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-teal-900">{volumeTotals.clanPosts.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-950">{volumeTotals.cardExchangePosts.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-teal-900">{volumeGrandTotal.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
        {!volumeLoading && !volumeError && volumePeriod === 'daily' && volumeRows.length > 0 && (
          <p className="text-xs text-slate-500 mt-3 border-t border-slate-100 pt-3">
            {t("admin.agentPerformance.volume.dailyDetailHint")}
          </p>
        )}
        {!volumeLoading && !volumeError && volumePeriod !== 'daily' && volumeDailyRows.length > 0 && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h4 className="text-base font-semibold text-slate-800">{t("admin.agentPerformance.volume.dailyDetailTitle")}</h4>
            <p className="text-xs text-slate-500 mt-1 mb-3">
              {t("admin.agentPerformance.volume.dailyDetailExplain")}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] text-slate-500">
                  {volumeColPc} · {t("admin.agentPerformance.periodSumLabel.daily")}
                </div>
                <div className="text-lg font-semibold tabular-nums">{dailyVolumeTotals.pubgPc.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] text-slate-500">
                  {volumeColMo} · {t("admin.agentPerformance.periodSumLabel.daily")}
                </div>
                <div className="text-lg font-semibold tabular-nums">{dailyVolumeTotals.pubgMobile.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2">
                <div className="text-[11px] text-teal-900/80">
                  {t("admin.agentPerformance.volume.table.clan")} · {t("admin.agentPerformance.periodSumLabel.daily")}
                </div>
                <div className="text-lg font-semibold tabular-nums text-teal-900">{dailyVolumeTotals.clanPosts.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2">
                <div className="text-[11px] text-amber-900/85">
                  {t("admin.agentPerformance.volume.table.cardExchange")} · {t("admin.agentPerformance.periodSumLabel.daily")}
                </div>
                <div className="text-lg font-semibold tabular-nums text-amber-950">{dailyVolumeTotals.cardExchangePosts.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-teal-200/80 bg-teal-700/5 px-3 py-2">
                <div className="text-[11px] text-teal-900/80">
                  {t("admin.agentPerformance.volume.table.total")} · {t("admin.agentPerformance.periodSumLabel.daily")}
                </div>
                <div className="text-lg font-bold tabular-nums text-teal-800">{dailyVolumeGrandTotal.toLocaleString()}</div>
              </div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-600">
                    <th className="px-3 py-2 font-medium">{t("admin.agentPerformance.volume.dailyDetailTitle")}</th>
                    <th className="px-3 py-2 font-medium text-right">{volumeColPc}</th>
                    <th className="px-3 py-2 font-medium text-right">{volumeColMo}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("admin.agentPerformance.volume.table.clan")}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("admin.agentPerformance.volume.table.cardExchange")}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("admin.agentPerformance.volume.table.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {volumeDailyRows.map((row) => (
                    <tr key={row.period} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2 font-mono text-slate-800">{row.period}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.pubgPc.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.pubgMobile.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-teal-800">{row.clanPosts.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-900">{row.cardExchangePosts.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                        {gameVolumeLineTotal(row).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100/90 border-t-2 border-slate-300/80 font-semibold text-slate-800">
                    <td className="px-3 py-2.5">{volumeBucketSumLabel}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{dailyVolumeTotals.pubgPc.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{dailyVolumeTotals.pubgMobile.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-teal-900">{dailyVolumeTotals.clanPosts.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-950">{dailyVolumeTotals.cardExchangePosts.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-teal-900">{dailyVolumeGrandTotal.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
        {!volumeLoading && !volumeError && volumeRows.length === 0 && (
          <p className="text-slate-500 text-sm py-4">{t("admin.agentPerformance.volume.empty")}</p>
        )}
      </div>

      {loading && <div className="text-slate-500 text-sm">{t("admin.agentPerformance.loading")}</div>}
      {error && <div className="text-red-500 text-sm">{error}</div>}

      {/* 전체 요약 카드 */}
      {totalStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white border rounded-xl shadow-sm p-4">
            <div className="text-xs text-slate-500 uppercase mb-1">{t("admin.agentPerformance.summary.totalProcessed")}</div>
            <div className="text-3xl font-bold text-blue-600">{totalStats.totalProcessed.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">{t("admin.agentPerformance.summary.agentCount", { n: stats.length })}</div>
          </div>
          
          <div className="bg-white border rounded-xl shadow-sm p-4">
            <div className="text-xs text-slate-500 uppercase mb-1">{t("admin.agentPerformance.summary.avgHandleTime")}</div>
            <div className="text-3xl font-bold text-purple-600">{formatTime(totalStats.avgHandleTime)}</div>
            <div className="text-xs text-slate-400 mt-1">{t("admin.agentPerformance.summary.avgHandleTimeHint")}</div>
          </div>
          
          <div className="bg-white border rounded-xl shadow-sm p-4">
            <div className="text-xs text-slate-500 uppercase mb-1">{t("admin.agentPerformance.summary.severityDist")}</div>
            <div className="flex items-end gap-2 mt-2">
              <div className="text-center flex-1">
                <div className="text-lg font-bold text-red-600">{totalStats.totalSev1}</div>
                <div className="text-xs text-slate-500">Sev1</div>
              </div>
              <div className="text-center flex-1">
                <div className="text-lg font-bold text-yellow-600">{totalStats.totalSev2}</div>
                <div className="text-xs text-slate-500">Sev2</div>
              </div>
              <div className="text-center flex-1">
                <div className="text-lg font-bold text-green-600">{totalStats.totalSev3}</div>
                <div className="text-xs text-slate-500">Sev3</div>
              </div>
            </div>
          </div>
          
          <div className="bg-white border rounded-xl shadow-sm p-4">
            <div className="text-xs text-slate-500 uppercase mb-1">{t("admin.agentPerformance.summary.sentimentDist")}</div>
            <div className="flex items-end gap-2 mt-2">
              <div className="text-center flex-1">
                <div className="text-lg font-bold text-green-600">{totalStats.totalPos}</div>
                <div className="text-xs text-slate-500">{t("admin.agentPerformance.summary.sentiment.pos")}</div>
              </div>
              <div className="text-center flex-1">
                <div className="text-lg font-bold text-slate-600">{totalStats.totalNeu}</div>
                <div className="text-xs text-slate-500">{t("admin.agentPerformance.summary.sentiment.neu")}</div>
              </div>
              <div className="text-center flex-1">
                <div className="text-lg font-bold text-red-600">{totalStats.totalNeg}</div>
                <div className="text-xs text-slate-500">{t("admin.agentPerformance.summary.sentiment.neg")}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 에이전트별 상세 통계 */}
      {stats.length > 0 && (
        <div className="space-y-4">
          {stats.map((stat) => (
            <div key={stat.agentId} className="bg-white border rounded-xl shadow-sm p-5">
              {/* 에이전트 헤더 */}
              <div className="flex items-center justify-between mb-4 pb-4 border-b">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{stat.agentName}</h3>
                  <p className="text-xs text-slate-500">{stat.agentEmail}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-600">{stat.totalProcessed}</div>
                  <div className="text-xs text-slate-500">{t("admin.agentPerformance.agentDetail.processedCount")}</div>
                </div>
              </div>

              {/* 통계 그리드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 처리 시간 */}
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.handleTimeTitle")}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">{t("admin.agentPerformance.agentDetail.avg")}</span>
                      <span className="font-semibold">{formatTime(stat.avgHandleTime)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">{t("admin.agentPerformance.agentDetail.median")}</span>
                      <span className="font-semibold">{formatTime(stat.medianHandleTime)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{t("admin.agentPerformance.agentDetail.fastest")}</span>
                      <span>{formatTime(stat.fastestHandleTime)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{t("admin.agentPerformance.agentDetail.slowest")}</span>
                      <span>{formatTime(stat.slowestHandleTime)}</span>
                    </div>
                  </div>
                </div>

                {/* 중요도 분포 */}
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.severityTitle")}</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-red-500 h-full"
                          style={{ 
                            width: `${stat.totalProcessed > 0 ? (stat.severityBreakdown.sev1 / stat.totalProcessed) * 100 : 0}%` 
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-16">Sev1: {stat.severityBreakdown.sev1}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-yellow-500 h-full"
                          style={{ 
                            width: `${stat.totalProcessed > 0 ? (stat.severityBreakdown.sev2 / stat.totalProcessed) * 100 : 0}%` 
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-16">Sev2: {stat.severityBreakdown.sev2}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-green-500 h-full"
                          style={{ 
                            width: `${stat.totalProcessed > 0 ? (stat.severityBreakdown.sev3 / stat.totalProcessed) * 100 : 0}%` 
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-16">Sev3: {stat.severityBreakdown.sev3}</span>
                    </div>
                  </div>
                </div>

                {/* 성향 분포 */}
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.sentimentTitle")}</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-green-500 h-full"
                          style={{ 
                            width: `${stat.totalProcessed > 0 ? (stat.sentimentBreakdown.pos / stat.totalProcessed) * 100 : 0}%` 
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-16">
                        {t("admin.agentPerformance.summary.sentiment.pos")}: {stat.sentimentBreakdown.pos}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-slate-500 h-full"
                          style={{ 
                            width: `${stat.totalProcessed > 0 ? (stat.sentimentBreakdown.neu / stat.totalProcessed) * 100 : 0}%` 
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-16">
                        {t("admin.agentPerformance.summary.sentiment.neu")}: {stat.sentimentBreakdown.neu}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-red-500 h-full"
                          style={{ 
                            width: `${stat.totalProcessed > 0 ? (stat.sentimentBreakdown.neg / stat.totalProcessed) * 100 : 0}%` 
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-16">
                        {t("admin.agentPerformance.summary.sentiment.neg")}: {stat.sentimentBreakdown.neg}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 상태별 분포 */}
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.statusTitle")}</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">{t("admin.agentPerformance.agentDetail.status.resolved")}</span>
                      <span className="font-semibold text-green-600">{stat.statusBreakdown.resolved}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">{t("admin.agentPerformance.agentDetail.status.inProgress")}</span>
                      <span className="font-semibold text-blue-600">{stat.statusBreakdown.inProgress}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">{t("admin.agentPerformance.agentDetail.status.triaged")}</span>
                      <span className="font-semibold text-yellow-600">{stat.statusBreakdown.triaged}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">{t("admin.agentPerformance.agentDetail.status.open")}</span>
                      <span className="font-semibold text-slate-600">{stat.statusBreakdown.open}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 카테고리별 & 프로젝트별 통계 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                {/* 카테고리별 */}
                {stat.categoryBreakdown.length > 0 && (
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.categoryTitle")}</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {stat.categoryBreakdown.map((cat, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-slate-600 truncate">
                            {cat.categoryGroup} &gt; {cat.category}
                          </span>
                          <span className="font-semibold text-slate-800 ml-2">{cat.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 프로젝트별 */}
                {stat.projectBreakdown.length > 0 && (
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.projectTitle")}</div>
                    <div className="space-y-2">
                      {stat.projectBreakdown.map((proj, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-blue-500 h-full"
                              style={{ 
                                width: `${stat.totalProcessed > 0 ? (proj.count / stat.totalProcessed) * 100 : 0}%` 
                              }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 w-32 truncate">{proj.projectName}</span>
                          <span className="text-xs font-semibold text-slate-800 w-12 text-right">{proj.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 일별 트렌드 */}
              {stat.dailyStats.length > 0 && (
                <div className="border rounded-lg p-3 mt-4">
                  <div className="text-xs text-slate-500 mb-2">{t("admin.agentPerformance.agentDetail.dailyTrendTitle")}</div>
                  <div className="overflow-x-auto">
                    <div className="flex items-end gap-1 min-w-max" style={{ height: '100px' }}>
                      {stat.dailyStats.map((day, idx) => {
                        const maxCount = Math.max(...stat.dailyStats.map(d => d.count));
                        const height = maxCount > 0 ? (day.count / maxCount) * 80 : 0;
                        
                        return (
                          <div key={idx} className="flex flex-col items-center gap-1" style={{ minWidth: '40px' }}>
                            <div className="text-xs text-slate-600 font-semibold">{day.count}</div>
                            <div 
                              className="w-6 bg-blue-500 rounded-t"
                              style={{ height: `${height}px` }}
                              title={`${day.date}: ${day.count}, ${t("admin.agentPerformance.agentDetail.avg")} ${formatTime(day.avgTime)}`}
                            />
                            <div className="text-xs text-slate-400 transform -rotate-45 origin-top-left mt-2">
                              {day.date.substring(5)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {stats.length === 0 && !loading && (
        <div className="bg-white border rounded-xl shadow-sm p-8 text-center">
          <p className="text-slate-500">{t("admin.agentPerformance.empty.title")}</p>
          <p className="text-xs text-slate-400 mt-1">{t("admin.agentPerformance.empty.hint")}</p>
        </div>
      )}
    </div>
  );
}

