import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import type { CustomerFeedbackNotice } from "../../types";
import { sortFeedbackNoticesEndedLast } from "../../utils/noticeSort";
import { Button } from "../../components/ui/Button";
import { cn } from "../../utils/cn";
import { NoticeEditor, type NoticeFormValue } from "../../components/NoticeEditor";
import { useCrawlerGames } from "../../hooks/useCrawlerGames";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

type GroupBy = "none" | "date" | "week" | "manager" | "game";

/** Tab/filter sentinel (not an API value); matches stored notice categories from DB. */
const CATEGORY_ALL = "전체";

type NoticeWithReadStatus = CustomerFeedbackNotice & {
  readAgents?: Array<{ id: string; name: string; readAt?: string }>;
  unreadAgents?: Array<{ id: string; name: string }>;
};

function getISOWeekKey(date: Date) {
  // Returns "YYYY-Www"
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday in current week decides the year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function toKstDateKey(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  // KST 기준 날짜로 정규화
  const kst = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return kst.toISOString().slice(0, 10);
}

export default function NoticesPage() {
  const { t, i18n } = useTranslation("pagesAgent");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";
  const { token, selectedProjectId, user } = useAuth();
  const { lookups: crawlerLookups } = useCrawlerGames(token);
  const [notices, setNotices] = useState<NoticeWithReadStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const noticeEditorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [noticeEditorOpen, setNoticeEditorOpen] = useState(false);
  const [editingNotice, setEditingNotice] = useState<CustomerFeedbackNotice | null>(null);
  const [noticeSubmitting, setNoticeSubmitting] = useState(false);

  const isStaff =
    user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN";

  const [search, setSearch] = useState("");
  const [categoryTab, setCategoryTab] = useState<string>(CATEGORY_ALL);
  const [game, setGame] = useState<string>("all");
  const [manager, setManager] = useState<string>("all");
  const [date, setDate] = useState<string>(""); // YYYY-MM-DD
  const [week, setWeek] = useState<string>(""); // YYYY-Www
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const formatGroupKey = useCallback(
    (key: string) => {
      if (key === CATEGORY_ALL) return t("notices.groupAll");
      if (key === "날짜 없음") return t("notices.noDate");
      if (key === "담당자 미지정") return t("notices.noManager");
      if (key === "게임 미지정") return t("notices.noGame");
      return key;
    },
    [t]
  );

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const availableGames = useMemo(() => {
    const set = new Set<string>();
    notices.forEach((n) => {
      const g = (n.gameName || "").trim();
      if (g) set.add(g);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [notices]);

  const scrollToNoticeEditor = () => {
    requestAnimationFrame(() => {
      noticeEditorAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openCreateNotice = () => {
    setEditingNotice(null);
    setNoticeEditorOpen(true);
    scrollToNoticeEditor();
  };

  const openEditNotice = (n: CustomerFeedbackNotice) => {
    setEditingNotice(n);
    setNoticeEditorOpen(true);
    scrollToNoticeEditor();
  };

  const closeNoticeEditor = () => {
    setNoticeEditorOpen(false);
    setEditingNotice(null);
  };

  const handleSaveNotice = async (form: NoticeFormValue) => {
    if (!token || !form.gameName || !form.managerName || !form.category || !form.content || !form.noticeDate) {
      alert(t("notices.alertRequiredFields"));
      return;
    }
    setNoticeSubmitting(true);
    try {
      const isEditing = editingNotice != null;
      const endpoint = isEditing ? `/api/feedback-notices/${editingNotice.id}` : "/api/feedback-notices";
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: {
          ...(authHeaders as Record<string, string>),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || (isEditing ? t("notices.errorEdit") : t("notices.errorCreate")));
      }
      await loadNotices();
      closeNoticeEditor();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("notices.errorSaveGeneric"));
    } finally {
      setNoticeSubmitting(false);
    }
  };

  const handleEndNotice = async (noticeId: number) => {
    if (!token) return;
    if (!confirm(t("notices.confirmEnd"))) return;
    try {
      const res = await fetch(`/api/feedback-notices/${noticeId}/end`, {
        method: "POST",
        headers: authHeaders as HeadersInit,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || t("notices.errorEnd"));
      }
      if (editingNotice?.id === noticeId) closeNoticeEditor();
      await loadNotices();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("notices.errorEnd"));
    }
  };

  const handleDeleteNotice = async (noticeId: number) => {
    if (!token) return;
    if (!confirm(t("notices.confirmDelete"))) return;
    try {
      const res = await fetch(`/api/feedback-notices/${noticeId}`, {
        method: "DELETE",
        headers: authHeaders as HeadersInit,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || t("notices.errorDelete"));
      }
      if (editingNotice?.id === noticeId) closeNoticeEditor();
      await loadNotices();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("notices.errorDelete"));
    }
  };

  const loadNotices = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const url = selectedProjectId
        ? `/api/feedback-notices?projectId=${selectedProjectId}`
        : "/api/feedback-notices";
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || t("notices.errorLoad"));
      }
      const body = await res.json();
      const data = Array.isArray(body?.data) ? body.data : (body?.data || []);
      setNotices(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("notices.errorLoadGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (noticeId: number) => {
    if (!token) return;
    setMarkingId(noticeId);
    try {
      const url = `/api/feedback-notices/${noticeId}/read`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...(authHeaders as Record<string, string>),
          "Content-Type": "application/json"
        },
        // agentId를 보내지 않으면 서버가 req.user.name으로 Agent를 찾아 기록합니다.
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || t("notices.errorMarkRead"));
      }
      // 새로고침 (readAgents/unreadAgents 갱신)
      await loadNotices();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("notices.errorMarkReadGeneric"));
    } finally {
      setMarkingId(null);
    }
  };

  useEffect(() => {
    loadNotices();
     
  }, [token, selectedProjectId]);

  const games = useMemo(() => {
    const set = new Set<string>();
    notices.forEach(n => n.gameName && set.add(n.gameName));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [notices]);

  const managers = useMemo(() => {
    const set = new Set<string>();
    notices.forEach(n => n.managerName && set.add(n.managerName));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [notices]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    notices.forEach(n => {
      const c = (n.category || "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [notices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notices.filter(n => {
      if (categoryTab !== CATEGORY_ALL && (n.category || "").trim() !== categoryTab) return false;
      if (game !== "all" && (n.gameName || "") !== game) return false;
      if (manager !== "all" && (n.managerName || "") !== manager) return false;

      // 날짜 필터
      if (date) {
        const key = toKstDateKey(n.noticeDate);
        if (key !== date) return false;
      }

      // 주차 필터
      if (week) {
        const d = new Date(n.noticeDate);
        if (getISOWeekKey(d) !== week) return false;
      }

      if (!q) return true;
      const hay = `${n.title || ""} ${n.gameName || ""} ${n.managerName || ""} ${n.category || ""} ${n.content || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [notices, search, categoryTab, game, manager, date, week]);

  const grouped = useMemo(() => {
    const map = new Map<string, NoticeWithReadStatus[]>();
    const keyOf = (n: NoticeWithReadStatus) => {
      if (groupBy === "none") return CATEGORY_ALL;
      if (groupBy === "date") return toKstDateKey(n.noticeDate) || "날짜 없음";
      if (groupBy === "week") return getISOWeekKey(new Date(n.noticeDate));
      if (groupBy === "manager") return n.managerName || "담당자 미지정";
      if (groupBy === "game") return n.gameName || "게임 미지정";
      return CATEGORY_ALL;
    };
    filtered.forEach(n => {
      const k = keyOf(n);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(n);
    });
    // 그룹 내 정렬: 진행 중 공지 먼저, 종료된 공지는 맨 아래 · 공지일 최신순
    for (const [k, items] of map.entries()) {
      map.set(k, sortFeedbackNoticesEndedLast(items));
    }
    // 키 정렬
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered, groupBy]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("notices.title")}</h1>
          <p className="text-sm text-slate-600">
            {t("notices.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {isStaff && (
            <Button onClick={openCreateNotice} variant="primary" size="sm">
              {t("notices.newNotice")}
            </Button>
          )}
          <Button onClick={loadNotices} disabled={loading} variant="ghost" size="sm">
            {t("notices.refresh")}
          </Button>
        </div>
      </div>

      {/* 카테고리 탭 */}
      <div className="mb-4 border-b border-slate-200">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCategoryTab(CATEGORY_ALL)}
            className={cn(
              "ui-tab rounded-t-lg",
              categoryTab === CATEGORY_ALL ? "ui-tab-active bg-blue-50" : "border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50"
            )}
          >
            {t("notices.allTab", { count: notices.length })}
          </button>
          {categories.map((cat) => {
            const count = notices.filter((n) => (n.category || "").trim() === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryTab(cat)}
                className={cn(
                  "ui-tab rounded-t-lg",
                  categoryTab === cat ? "ui-tab-active bg-blue-50" : "border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                )}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder={t("notices.searchPlaceholder")}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
        />
        <select
          value={game}
          onChange={(e) => setGame(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">{t("notices.gameAll")}</option>
          {games.map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select
          value={manager}
          onChange={(e) => setManager(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">{t("notices.managerAll")}</option>
          {managers.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <LocalizedDateInput
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          title={t("notices.filterByDateTitle")}
        />
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          title={t("notices.groupByTitle")}
        >
          <option value="date">{t("notices.groupDate")}</option>
          <option value="week">{t("notices.groupWeek")}</option>
          <option value="manager">{t("notices.groupManager")}</option>
          <option value="game">{t("notices.groupGame")}</option>
          <option value="none">{t("notices.groupNone")}</option>
        </select>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <LocalizedDateInput
          type="week"
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          title={t("notices.filterByWeekTitle")}
        />
        <div className="md:col-span-4 flex items-center gap-2 text-xs text-slate-600">
          <span>{t("notices.totalCount", { count: filtered.length })}</span>
          <button
            onClick={() => {
              setSearch("");
              setCategoryTab(CATEGORY_ALL);
              setGame("all");
              setManager("all");
              setDate("");
              setWeek("");
              setGroupBy("none");
            }}
            className="px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
          >
            {t("notices.resetFilters")}
          </button>
          {isStaff && (
            <span className="text-slate-500">
              {t("notices.staffHint")}
            </span>
          )}
        </div>
      </div>

      {noticeEditorOpen && isStaff && (
        <div ref={noticeEditorAnchorRef} className="mb-6">
          <NoticeEditor
            editingNotice={editingNotice}
            availableGames={availableGames}
            gameLabelByCode={crawlerLookups.labelByCode}
            submitting={noticeSubmitting}
            onCancel={closeNoticeEditor}
            onSave={handleSaveNotice}
            onEnd={handleEndNotice}
          />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500">{t("notices.loading")}</div>
      ) : grouped.length === 0 ? (
        <div className="p-8 text-center text-slate-500">{t("notices.empty")}</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([groupKey, items]) => (
            <div key={groupKey} className="ui-card overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="font-semibold text-slate-800">{formatGroupKey(groupKey)}</div>
                <div className="text-xs text-slate-500">{t("notices.groupItemCount", { count: items.length })}</div>
              </div>
              <div className="p-3">
                {(() => {
                  const isDesktopNotice = (name?: string | null) =>
                    /pubg\s*pc|데스크톱|desktop|공식\s*pc/i.test(String(name || ""));
                  const isMobileNotice = (name?: string | null) => {
                    const s = String(name || "");
                    if (isDesktopNotice(s)) return false;
                    return /pubgm|pubg\s*mobile|모바일|\bmobile\b/i.test(s);
                  };
                  const pcItems = items.filter((n) => isDesktopNotice(n.gameName));
                  const pubgmItems = items.filter((n) => isMobileNotice(n.gameName));
                  const otherItems = items.filter(
                    (n) => !isDesktopNotice(n.gameName) && !isMobileNotice(n.gameName)
                  );

                  const renderNotice = (n: NoticeWithReadStatus) => {
                    const isReadByMe = (n.readAgents || []).some((r) => r.name === user?.name);
                    const isEnded = !!(n.endedAt && String(n.endedAt).trim());
                    const titleText = n.title?.trim() || t("notices.defaultTitle");
                    return (
                    <div
                      key={n.id}
                      className={`px-3 py-3 rounded-lg ${
                        isReadByMe
                          ? "bg-white hover:bg-slate-50"
                          : "bg-red-50/90 hover:bg-red-100/80 border border-red-100"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-base font-semibold break-words ${
                              isEnded ? "text-slate-500 line-through" : "text-slate-900"
                            }`}
                          >
                            {titleText}
                          </div>
                          <div
                            className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${
                              isEnded ? "text-slate-500" : "text-slate-600"
                            }`}
                          >
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                              {n.gameName}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                              {n.managerName}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                              {n.category}
                            </span>
                            {isEnded && n.endedAt && (
                              <span className="text-slate-500">
                                {t("notices.ended")}{" "}
                                {new Date(n.endedAt).toLocaleDateString(dateLocale, { timeZone: "Asia/Seoul" })}
                              </span>
                            )}
                            {n.url && (
                              <a
                                href={n.url.startsWith("http://") || n.url.startsWith("https://") ? n.url : `https://${n.url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 border border-blue-200"
                                title={n.url}
                              >
                                {t("notices.link")}
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <div className="text-xs text-slate-500">
                            {(() => {
                              const createdAt = new Date(n.createdAt);
                              const updatedAt = new Date(n.updatedAt);
                              const isModified = updatedAt.getTime() > createdAt.getTime() + 1000;
                              const displayDate = isModified ? updatedAt : createdAt;
                              return (
                                <span
                                  title={
                                    isModified
                                      ? t("notices.tooltipModified", {
                                          time: updatedAt.toLocaleString(dateLocale, { timeZone: "Asia/Seoul" }),
                                        })
                                      : t("notices.tooltipCreated", {
                                          time: createdAt.toLocaleString(dateLocale, { timeZone: "Asia/Seoul" }),
                                        })
                                  }
                                >
                                  {isModified && (
                                    <span className="text-blue-600 mr-1">{t("notices.modifiedBadge")}</span>
                                  )}
                                  {displayDate.toLocaleString(dateLocale, {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: "Asia/Seoul",
                                  })}
                                </span>
                              );
                            })()}
                          </div>
                          <Button
                            onClick={() => markAsRead(Number(n.id))}
                            disabled={markingId === Number(n.id)}
                            variant="primary"
                            size="sm"
                            title={t("notices.markReadTitle")}
                          >
                            {markingId === Number(n.id) ? t("notices.markReadProcessing") : t("notices.markRead")}
                          </Button>
                          {isStaff && (
                            <>
                              <Button
                                type="button"
                                onClick={() => openEditNotice(n)}
                                variant="outline"
                                size="sm"
                                title={t("notices.editTitle")}
                              >
                                {t("notices.edit")}
                              </Button>
                              {!isEnded && (
                                <Button
                                  type="button"
                                  onClick={() => handleEndNotice(Number(n.id))}
                                  variant="outline"
                                  size="sm"
                                  className="border-amber-300 text-amber-800 hover:bg-amber-50"
                                  title={t("notices.endTitle")}
                                >
                                  {t("notices.endVerb")}
                                </Button>
                              )}
                              <Button
                                type="button"
                                onClick={() => handleDeleteNotice(Number(n.id))}
                                variant="outline"
                                size="sm"
                                className="border-red-200 text-red-700 hover:bg-red-50"
                                title={t("notices.deleteTitle")}
                              >
                                {t("notices.deleteVerb")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {(user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN") && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="font-semibold">{t("notices.readLabel")}</span>
                          {(n.readAgents || []).length > 0 ? (
                            <>
                              {(n.readAgents || []).slice(0, 8).map((a) => (
                                <span
                                  key={a.id}
                                  className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                                >
                                  {a.name}
                                </span>
                              ))}
                              {(n.readAgents || []).length > 8 && (
                                <span className="text-slate-500">
                                  {t("notices.peopleMore", { n: (n.readAgents || []).length - 8 })}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">{t("notices.noneShort")}</span>
                          )}
                          <span className="mx-1 text-slate-300">|</span>
                          <span className="font-semibold">{t("notices.unreadLabel")}</span>
                          {(n.unreadAgents || []).length > 0 ? (
                            <>
                              {(n.unreadAgents || []).slice(0, 8).map((a) => (
                                <span
                                  key={a.id}
                                  className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
                                >
                                  {a.name}
                                </span>
                              ))}
                              {(n.unreadAgents || []).length > 8 && (
                                <span className="text-slate-500">
                                  {t("notices.peopleMore", { n: (n.unreadAgents || []).length - 8 })}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">{t("notices.noneShort")}</span>
                          )}
                        </div>
                      )}

                      <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words">
                        {(() => {
                          const fullText = String(n.content || "");
                          const text =
                            fullText.length > 400 ? `${fullText.slice(0, 400)}...` : fullText;
                          const urlRegex = /(https?:\/\/[^\s]+)/g;
                          const parts: (string | JSX.Element)[] = [];
                          let lastIndex = 0;
                          let match: RegExpExecArray | null;

                          while ((match = urlRegex.exec(text)) !== null) {
                            if (match.index > lastIndex) {
                              parts.push(text.substring(lastIndex, match.index));
                            }
                            const url = match[0];
                            parts.push(
                              <a
                                key={match.index}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline break-all"
                              >
                                {url}
                              </a>
                            );
                            lastIndex = match.index + url.length;
                          }

                          if (lastIndex < text.length) {
                            parts.push(text.substring(lastIndex));
                          }

                          return parts.length > 0 ? parts : text;
                        })()}
                      </div>
                    </div>
                  );
                  };

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div className="ui-card">
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                          <div className="text-xs font-semibold text-slate-800">{t("notices.columnA")}</div>
                          <div className="text-xs text-slate-500">{t("notices.groupItemCount", { count: pcItems.length })}</div>
                        </div>
                        <div className="py-2">
                          {pcItems.length === 0 ? (
                            <div className="py-4 text-center text-xs text-slate-400">
                              {t("notices.emptyGroup")}
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-100">{pcItems.map(renderNotice)}</div>
                          )}
                        </div>
                      </div>

                      <div className="ui-card">
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                          <div className="text-xs font-semibold text-slate-800">{t("notices.columnB")}</div>
                          <div className="text-xs text-slate-500">{t("notices.groupItemCount", { count: pubgmItems.length })}</div>
                        </div>
                        <div className="py-2">
                          {pubgmItems.length === 0 ? (
                            <div className="py-4 text-center text-xs text-slate-400">
                              {t("notices.emptyGroup")}
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-100">{pubgmItems.map(renderNotice)}</div>
                          )}
                        </div>
                      </div>

                      {otherItems.length > 0 && (
                        <div className="lg:col-span-2 ui-card">
                          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                            <div className="text-xs font-semibold text-slate-800">{t("notices.columnCommon")}</div>
                            <div className="text-xs text-slate-500">{t("notices.groupItemCount", { count: otherItems.length })}</div>
                          </div>
                          <div className="py-2 divide-y divide-slate-100">
                            {otherItems.map(renderNotice)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

