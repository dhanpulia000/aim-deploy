import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { logger } from "../../utils/logger";

interface CommentWatchItem {
  issueId: string;
  enabled: boolean;
  intervalSeconds: number;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastError: string | null;
  updatedAt: string;
  projectId: number | null;
  title: string;
  sourceUrl: string | null;
  commentCount: number;
  scrapedComments: string | null;
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const loc = locale.startsWith("ko") ? "ko-KR" : "en-US";
  return d.toLocaleString(loc, { timeZone: "Asia/Seoul" });
}

function commentWatchPatchUrl(issueId: string, projectId: number | null | undefined) {
  const enc = encodeURIComponent(issueId);
  const qs = projectId != null ? `?projectId=${projectId}` : "";
  return `/api/issues/${enc}/comment-watch${qs}`;
}

/** 네이버 카페 원문 URL이 있으면 새 탭, 없으면 앱에서 이슈 패널 */
function openIssueOrCafeOriginal(it: CommentWatchItem) {
  const url = it.sourceUrl?.trim();
  if (url && /^https?:\/\//i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  window.dispatchEvent(new CustomEvent("selectIssue", { detail: { issueId: it.issueId } }));
}

export default function CommentWatchManagement() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token, selectedProjectId, user } = useAuth();
  const authHeaders = useMemo(() => createAuthHeaders(token), [token]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CommentWatchItem[]>([]);
  const [unmanageIssueId, setUnmanageIssueId] = useState<string | null>(null);
  const lastReloadAtRef = useRef(0);

  const projectQuery = selectedProjectId ? `&projectId=${selectedProjectId}` : "";

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/issues/comment-watches?enabledOnly=true&limit=200&offset=0${projectQuery}`;
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load comment watches (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      const data = json.data ?? json;
      setItems(data?.watches ?? []);
    } catch (e: any) {
      setError(e?.message || t("admin.commentWatch.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, authHeaders, projectQuery, t]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedProjectId]);

  // App에서 전파하는 실시간 이벤트를 수신해 리스트를 갱신
  useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<{ issueId?: string; projectId?: number | null }>;
      const issueId = ce.detail?.issueId;
      if (!issueId) return;
      if (selectedProjectId != null && ce.detail?.projectId != null && ce.detail.projectId !== selectedProjectId) {
        return;
      }
      const now = Date.now();
      if (now - lastReloadAtRef.current < 2000) return;
      lastReloadAtRef.current = now;
      load().catch((e) => logger.error("[CommentWatchManagement] reload failed", { error: String(e) }));
    };
    window.addEventListener("issueCommentsUpdated", handler as any);
    return () => {
      window.removeEventListener("issueCommentsUpdated", handler as any);
    };
  }, [load, selectedProjectId]);

  const handleUnmanage = async (it: CommentWatchItem) => {
    if (!token || !authHeaders) return;
    if (
      !window.confirm(
        t("admin.commentWatch.unmanageConfirm", { line: it.title || it.issueId })
      )
    )
      return;
    setUnmanageIssueId(it.issueId);
    setError(null);
    try {
      const projectId = it.projectId ?? selectedProjectId ?? undefined;
      const url = commentWatchPatchUrl(it.issueId, projectId ?? null);
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || t("admin.commentWatch.unmanageFailed"));
    } finally {
      setUnmanageIssueId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{t("admin.commentWatch.heading")}</h2>
          <p className="text-xs text-slate-500 mt-1">{t("admin.commentWatch.sub1")}</p>
          <p className="text-xs text-slate-500 mt-2">
            {selectedProjectId != null
              ? t("admin.commentWatch.showingCountProject", {
                  n: items.length,
                  projectId: selectedProjectId,
                })
              : t("admin.commentWatch.showingCount", { n: items.length })}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={load}
            disabled={!token || loading}
            className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-medium disabled:opacity-50"
          >
            {loading ? t("admin.commentWatch.refreshing") : t("admin.commentWatch.refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">
                  {t("admin.commentWatch.table.issue")}
                </th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">
                  {t("admin.commentWatch.table.comments")}
                </th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">
                  {t("admin.commentWatch.table.interval")}
                </th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">
                  {t("admin.commentWatch.table.nextRun")}
                </th>
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">
                  {t("admin.commentWatch.table.lastResult")}
                </th>
                <th className="text-right px-4 py-3 font-semibold whitespace-nowrap min-w-[12rem]">
                  {t("admin.commentWatch.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.issueId} className="border-t last:border-b">
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1">
                      <div className="font-semibold text-slate-800">{it.title || it.issueId}</div>
                      <div className="text-[11px] text-slate-500 break-all">{it.issueId}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-800">
                      {t("admin.commentWatch.commentsCount", { n: it.commentCount ?? 0 })}
                    </div>
                    {it.lastError && (
                      <div className="text-[11px] text-amber-700 mt-1">{it.lastError}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-800">
                      {t("admin.commentWatch.intervalMinutes", { n: it.intervalMinutes })}
                    </div>
                    <div className="text-[11px] text-slate-500">({it.intervalSeconds}s)</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-slate-800 font-semibold">
                      {formatDate(it.nextRunAt, i18n.language)}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-slate-800 font-semibold">
                      {formatDate(it.lastRunAt, i18n.language)}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <div className="inline-flex flex-row flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openIssueOrCafeOriginal(it)}
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                        disabled={
                          Boolean(it.sourceUrl?.trim() && /^https?:\/\//i.test(it.sourceUrl.trim()))
                            ? false
                            : !user || !token
                        }
                        title={
                          it.sourceUrl?.trim() && /^https?:\/\//i.test(it.sourceUrl.trim())
                            ? t("admin.commentWatch.openTitleCafe")
                            : t("admin.commentWatch.openTitleApp")
                        }
                      >
                        {t("admin.commentWatch.open")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnmanage(it)}
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        disabled={!token || unmanageIssueId === it.issueId}
                        title={t("admin.commentWatch.unmanageTitle")}
                      >
                        {unmanageIssueId === it.issueId
                          ? t("admin.commentWatch.unmanageWorking")
                          : t("admin.commentWatch.unmanage")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500 text-sm">
                    {t("admin.commentWatch.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

