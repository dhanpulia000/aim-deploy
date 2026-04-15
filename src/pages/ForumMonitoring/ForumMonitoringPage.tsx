import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type DailyReport = {
  id: number;
  source: string;
  date_kst: string;
  window_start_at: string;
  window_end_at: string;
  category_summary: Record<string, { new_topics?: number; hot_score_sum?: number }>;
  hot_topics: Array<{
    topic_id: number;
    title?: string;
    url?: string;
    external_topic_id?: number;
    mode?: string;
    delta_replies?: number;
    delta_likes?: number;
    delta_views?: number;
    score?: number;
  }>;
  new_topics: Array<{ topic_id: number; title: string; url: string }>;
  reactivated_topics: Array<Record<string, unknown>>;
  generated_at: string;
  version: number;
};

const API_BASE = import.meta.env.VITE_FORUM_MONITORING_BASE || "/forum-api";

async function fetchLatestDailyReport(): Promise<DailyReport | null> {
  const res = await fetch(`${API_BASE}/v1/reports/daily/latest`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as DailyReport;
}

export default function ForumMonitoringPage() {
  const { t } = useTranslation("app");
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchLatestDailyReport();
      setReport(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryRows = useMemo(() => {
    const cs = report?.category_summary || {};
    return Object.entries(cs)
      .map(([categoryId, v]) => ({
        categoryId,
        newTopics: v?.new_topics ?? 0,
        hotScoreSum: v?.hot_score_sum ?? 0
      }))
      .sort((a, b) => b.newTopics - a.newTopics);
  }, [report]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{t("forumMonitoring.sectionLabel")}</div>
          <h2 className="text-xl font-semibold text-slate-800">{t("forumMonitoring.title")}</h2>
          <div className="text-sm text-slate-500">
            {report ? (
              <>
                {t("forumMonitoring.window", { start: report.window_start_at, end: report.window_end_at })} ·{" "}
                {t("forumMonitoring.version", { v: report.version })}
              </>
            ) : (
              t("forumMonitoring.noData")
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-soft hover:bg-slate-50 ui-focus-ring"
          >
            {loading ? t("forumMonitoring.refreshing") : t("forumMonitoring.refresh")}
          </button>
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-soft hover:bg-slate-50 ui-focus-ring"
          >
            {t("forumMonitoring.openApiDocs")}
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div>{t("forumMonitoring.loadError", { message: error })}</div>
          {/HTTP 5\d{2}/.test(error) && (
            <p className="mt-2 text-xs font-normal text-red-800/90">{t("forumMonitoring.serverErrorHint")}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="text-sm font-semibold text-slate-800">{t("forumMonitoring.cardHotTopics")}</div>
          <div className="mt-2 text-xs text-slate-500">{t("forumMonitoring.cardHotTopicsHint")}</div>
          <div className="mt-3 space-y-2">
            {(report?.hot_topics || []).slice(0, 10).map((h, idx) => {
              const discId = h.external_topic_id ?? h.topic_id;
              const label =
                h.title && h.title.trim().length > 0 ? h.title : `#${discId ?? "?"}`;
              const modeSuffix = h.mode ? ` (${h.mode})` : "";
              const rowInner = (
                <>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {label}
                      {modeSuffix ? <span className="text-xs font-normal text-slate-500">{modeSuffix}</span> : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      #{discId} · Δr {h.delta_replies ?? 0} · Δl {h.delta_likes ?? 0} · Δv {h.delta_views ?? 0}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold text-slate-700">{Number(h.score ?? 0).toFixed(2)}</div>
                </>
              );
              const key = `${h.topic_id ?? idx}`;
              if (h.url && h.url.length > 0) {
                return (
                  <a
                    key={key}
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100 ui-focus-ring"
                  >
                    {rowInner}
                  </a>
                );
              }
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                  {rowInner}
                </div>
              );
            })}
            {report && (report.hot_topics || []).length === 0 && (
              <div className="py-4 text-center text-sm text-slate-400">{t("forumMonitoring.emptyHotTopics")}</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="text-sm font-semibold text-slate-800">{t("forumMonitoring.cardNewTopics")}</div>
          <div className="mt-2 text-xs text-slate-500">{t("forumMonitoring.cardNewTopicsHint")}</div>
          <div className="mt-3 space-y-2">
            {(report?.new_topics || []).slice(0, 10).map((nt) => (
              <a
                key={nt.topic_id}
                href={nt.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100 ui-focus-ring"
              >
                <div className="truncate text-sm font-medium text-slate-800">{nt.title}</div>
                <div className="text-xs text-slate-500">#{nt.topic_id}</div>
              </a>
            ))}
            {report && (report.new_topics || []).length === 0 && (
              <div className="py-4 text-center text-sm text-slate-400">{t("forumMonitoring.emptyNewTopics")}</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="text-sm font-semibold text-slate-800">{t("forumMonitoring.cardCategorySummary")}</div>
          <div className="mt-2 text-xs text-slate-500">{t("forumMonitoring.cardCategorySummaryHint")}</div>
          <div className="mt-3 space-y-2">
            {categoryRows.slice(0, 12).map((c) => (
              <div key={c.categoryId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-sm font-medium text-slate-800">{t("forumMonitoring.categoryId", { id: c.categoryId })}</div>
                <div className="text-xs text-slate-600">
                  {t("forumMonitoring.categorySummaryRow", { newTopics: c.newTopics, hotScoreSum: c.hotScoreSum.toFixed(2) })}
                </div>
              </div>
            ))}
            {report && categoryRows.length === 0 && (
              <div className="py-4 text-center text-sm text-slate-400">{t("forumMonitoring.emptyCategorySummary")}</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="text-sm font-semibold text-slate-800">{t("forumMonitoring.howTo")}</div>
        <div className="mt-2 text-sm text-slate-600">
          <div>{t("forumMonitoring.howToLine1", { base: API_BASE })}</div>
          <div className="mt-1">{t("forumMonitoring.howToLine2")}</div>
        </div>
      </div>
    </div>
  );
}

