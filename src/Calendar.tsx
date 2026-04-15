import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth/AuthContext";
import { Button } from "./components/ui/Button";
import { LocalizedDateInput } from "./components/LocalizedDateInput";

type PlatformFilter = "ALL" | "PC" | "MO";

interface CalendarEvent {
  id: number;
  platform: "PC" | "MO";
  startDate: string;
  endDate: string;
  title: string;
  link: string | null;
  lineChannelId?: string | null;
  discordWebhookUrl?: string | null;
  discordMention?: string | null;
  message?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** YYYY-MM-DD 형식 (Asia/Seoul 기준) */
function formatKSTDate(d: Date): string {
  try {
    const str = d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  } catch {
    /* fallback */
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 한국 시간 표시 (Asia/Seoul 명시) */
function formatKSTDateTime(d: Date, locale: string): string {
  return d.toLocaleString(locale, {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** HH:mm 형식 (24시간, KST) - time input 호환 */
function formatKSTTime(d: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function getMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  // 3개월 전 1일 ~ 3개월 후 마지막 일 (오늘 이전·이후 일정 등록 가능)
  const start = new Date(y, m - 3, 1, 0, 0, 0);
  const end = new Date(y, m + 4, 0, 23, 59, 59);
  return { start, end };
}

/** loadEvents 쿼리용: KST 기준 ISO 형식 (백엔드 저장 형식과 일치) */
function formatRangeForApi(d: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const y = get("year");
    const m = get("month").padStart(2, "0");
    const day = get("day").padStart(2, "0");
    const h = get("hour").padStart(2, "0");
    const min = get("minute").padStart(2, "0");
    const s = get("second").padStart(2, "0");
    if (y && m && day) return `${y}-${m}-${day}T${h}:${min}:${s}+09:00`;
  } catch {
    /* fallback */
  }
  const y2 = d.getFullYear();
  const m2 = String(d.getMonth() + 1).padStart(2, "0");
  const d2 = String(d.getDate()).padStart(2, "0");
  const h2 = String(d.getHours()).padStart(2, "0");
  const min2 = String(d.getMinutes()).padStart(2, "0");
  const s2 = String(d.getSeconds()).padStart(2, "0");
  return `${y2}-${m2}-${d2}T${h2}:${min2}:${s2}+09:00`;
}

interface FormData {
  platform: "PC" | "MO";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  title: string;
  link: string;
  lineChannelId: string;
  discordWebhookUrl: string;
  discordMention: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  platform: "PC",
  startDate: "",
  startTime: "09:00",
  endDate: "",
  endTime: "18:00",
  allDay: false,
  title: "",
  link: "",
  lineChannelId: "",
  discordWebhookUrl: "",
  discordMention: "",
  message: "",
};

function renderMonthGrid(year: number, monthIndex: number): Date[][] {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const firstDay = first.getDay();
  const daysInMonth = last.getDate();

  const days: Date[] = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(new Date(0));
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, monthIndex, d));
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    let week = days.slice(i, i + 7);
    while (week.length < 7) {
      week = [...week, new Date(0)];
    }
    weeks.push(week);
  }
  return weeks;
}

const WEEKDAY_KEYS = ["weekday0", "weekday1", "weekday2", "weekday3", "weekday4", "weekday5", "weekday6"] as const;

/** API 베이스 URL (VITE_API_BASE 미설정 시 빈 문자열 → 상대 경로 사용) */
const API_BASE = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

type LineTarget = {
  id: string;
  type: string;
  targetId: string;
  name?: string | null;
  displayName?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
};

const DISCORD_WEBHOOK_OPTIONS: { id: "none" | "banAppeal" | "odds"; url: string }[] = [
  { id: "none", url: "" },
  {
    id: "banAppeal",
    url: "https://discord.com/api/webhooks/1467767582663774323/uEkyOOa_mYguN2ABNatfZJiErB-GKbgY19w9Cv3SNf2ZDNxMEt0Oqit0atXK2825N1CW",
  },
  {
    id: "odds",
    url: "https://discord.com/api/webhooks/1467768269355225316/nADmAdJIdETR1wIwSUV2AV8dqzcVx9jIdx3uTYrj7yo_fcSbqWxS0Q0kq1VIS-bCKHW-",
  },
];

export default function Calendar() {
  const { t, i18n } = useTranslation("pagesCalendar");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";
  const { token, user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("ALL");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [lineTargets, setLineTargets] = useState<LineTarget[]>([]);
  const [loadingLineTargets, setLoadingLineTargets] = useState(false);

  const isAdmin = user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN";
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();

  const monthRange = useMemo(() => getMonthRange(), []);

  const loadEvents = useCallback(async () => {
    if (!token) return;
    const { start, end } = monthRange;
    const startStr = formatRangeForApi(start);
    const endStr = formatRangeForApi(end);
    try {
      const res = await fetch(
        `${API_BASE}/api/calendar/events?startDate=${encodeURIComponent(startStr)}&endDate=${encodeURIComponent(endStr)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        let msg = t("loadFailed");
        try {
          const errBody = await res.json();
          const detail = errBody?.message || errBody?.error || "";
          if (res.status === 401) {
            msg = t("sessionExpired");
          } else if (res.status === 404) {
            msg = t("api404");
          } else if (res.status >= 500) {
            msg = detail ? t("serverErrorDetail", { detail }) : t("serverError");
          } else if (detail) {
            msg = t("loadFailedDetail", { detail });
          }
        } catch {
          if (res.status === 401) msg = t("sessionExpired");
        }
        alert(msg);
        return;
      }
      const body = await res.json();
      setEvents(body.data?.events ?? body.events ?? []);
    } catch (e) {
      console.error(e);
      const errMsg = e instanceof Error ? e.message : String(e);
      const isNetwork = errMsg.includes("fetch") || errMsg.includes("Network") || errMsg.includes("Failed to fetch");
      alert(
        isNetwork
          ? t("networkError")
          : t("loadFailedDetail", { detail: errMsg })
      );
    } finally {
      setLoading(false);
    }
  }, [token, monthRange, t]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!isDialogOpen || !token || !isAdmin) return;
    let cancelled = false;
    setLoadingLineTargets(true);
    fetch(`${API_BASE}/api/line/targets`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        return body.data || body;
      })
      .then((data) => {
        if (cancelled) return;
        setLineTargets(Array.isArray(data) ? (data as LineTarget[]) : []);
      })
      .catch((e) => {
        console.error("[Calendar] Failed to load LINE targets", e);
        if (!cancelled) setLineTargets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLineTargets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDialogOpen, token, isAdmin]);

  const filteredEvents = useMemo(() => {
    if (platformFilter === "ALL") return events;
    return events.filter((e) => e.platform === platformFilter);
  }, [events, platformFilter]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of filteredEvents) {
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);
      const startDateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDateOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
      let current = new Date(startDateOnly);
      while (current <= endDateOnly) {
        const key = formatKSTDate(current);
        if (!map[key]) map[key] = [];
        map[key].push(event);
        current.setDate(current.getDate() + 1);
      }
    }
    return map;
  }, [filteredEvents]);

  const handleOpenCreate = () => {
    const today = new Date();
    const todayStr = formatKSTDate(today);
    setFormData({
      ...INITIAL_FORM,
      startDate: todayStr,
      endDate: todayStr,
      startTime: "09:00",
      endTime: "18:00",
      allDay: false,
    });
    setEditingId(null);
    setIsDialogOpen(true);
  };

  const handleEditEvent = (event: CalendarEvent) => {
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    const startTimeStr = formatKSTTime(start);
    const endTimeStr = formatKSTTime(end);
    const startDateStr = formatKSTDate(start);
    const endDateStr = formatKSTDate(end);
    const isAllDay = startDateStr === endDateStr && startTimeStr === "00:00" && endTimeStr === "23:59";
    setFormData({
      platform: event.platform,
      startDate: startDateStr,
      startTime: isAllDay ? "00:00" : startTimeStr,
      endDate: endDateStr,
      endTime: isAllDay ? "23:59" : endTimeStr,
      allDay: isAllDay,
      title: event.title,
      link: event.link || "",
      lineChannelId: event.lineChannelId || "",
      discordWebhookUrl: event.discordWebhookUrl || "",
      discordMention: event.discordMention || "",
      message: event.message || "",
    });
    setEditingId(event.id);
    setSelectedEvent(null);
    setIsDialogOpen(true);
  };

  const handleViewEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setIsDialogOpen(false);
  };

  const handleSaveEvent = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!token || !isAdmin) {
      alert(t("forbiddenSave"));
      return;
    }
    if (saving) return;
    const {
      startDate,
      startTime,
      endDate,
      endTime,
      allDay,
      title,
      platform,
      link,
      lineChannelId,
      discordWebhookUrl,
      discordMention,
      message,
    } = formData;
    if (!startDate || !title.trim()) {
      alert(t("needTitle"));
      return;
    }
    const hasLine = !!String(lineChannelId || "").trim();
    const hasDiscord = !!String(discordWebhookUrl || "").trim();
    if (!hasLine && !hasDiscord) {
      alert(t("needNotifyTarget"));
      return;
    }

    const normTime = (t: string): string => {
      const s = String(t || "").replace(/\s/g, "").replace(/[오전오후]/gi, "");
      const parts = s.split(":");
      const h = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
      const m = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const effectiveStartTime = allDay ? "00:00" : (startTime || "09:00");
    const effectiveEndTime = allDay ? "23:59" : (endTime || "18:00");
    const effectiveEndDate = allDay ? startDate : (endDate || startDate);

    const startISO = `${startDate}T${normTime(effectiveStartTime)}:00+09:00`;
    const endISO = `${effectiveEndDate}T${normTime(effectiveEndTime)}:00+09:00`;

    if (startISO > endISO) {
      alert(t("endBeforeStart"));
      return;
    }

    setSaving(true);
    try {
      const url = editingId
        ? `/api/calendar/events/${editingId}`
        : "/api/calendar/events";
      const method = editingId ? "PUT" : "POST";
      const payload = {
        platform,
        startDate: startISO,
        endDate: endISO,
        title: title.trim(),
        link: (link ?? "").toString().trim() || null,
        lineChannelId: hasLine ? String(lineChannelId).trim() : null,
        discordWebhookUrl: hasDiscord ? String(discordWebhookUrl).trim() : null,
        discordMention: String(discordMention || "").trim() || null,
        message: String(message || "").trim() || null,
      };
      const body = JSON.stringify(payload);

      const res = await fetch(`${API_BASE}${url}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
      });

      let data: Record<string, unknown> = {};
      try {
        const rawText = await res.text();
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        console.error("[Calendar] 응답 파싱 실패", res.status);
      }

      if (res.status === 403) {
        alert(t("forbiddenSave"));
        return;
      }
      if (res.status === 401) {
        alert(t("sessionExpired"));
        return;
      }
      if (!res.ok) {
        const d = data as { message?: string; error?: string; errors?: Array<{ field?: string; message?: string }> };
        const errParts: string[] = [];
        if (d.errors?.length) {
          errParts.push(...d.errors.map((e) => e.message || e.field || "").filter(Boolean));
        }
        const errMsg = errParts.length ? errParts.join("\n") : (d.message || d.error || t("saveFailed"));
        console.error("[Calendar] Save failed", { status: res.status, data });
        alert(errMsg);
        return;
      }

      setIsDialogOpen(false);
      setFormData(INITIAL_FORM);
      setEditingId(null);
      loadEvents();
    } catch (e) {
      console.error("[Calendar] Save error", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      const isNetwork = errMsg.includes("fetch") || errMsg.includes("Network") || errMsg.includes("Failed to fetch");
      alert(
        isNetwork
          ? t("networkError")
          : t("saveFailedDetail", { detail: errMsg })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId?: number) => {
    const id = eventId ?? selectedEvent?.id;
    if (!id || !token || !isAdmin) {
      if (!isAdmin) alert(t("forbiddenDelete"));
      return;
    }
    if (!confirm(t("confirmDelete"))) return;

    try {
      const res = await fetch(`${API_BASE}/api/calendar/events/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        alert(t("forbiddenDelete"));
        return;
      }
      if (!res.ok) {
        alert(data.message || t("deleteFailed"));
        return;
      }

      setSelectedEvent(null);
      setIsDialogOpen(false);
      setFormData(INITIAL_FORM);
      setEditingId(null);
      loadEvents();
    } catch (e) {
      console.error(e);
      alert(t("deleteFailed"));
    }
  };

  const todayKey = formatKSTDate(now);
  const minDate = "2010-01-01";
  const maxDate = "2040-12-31";

  return (
    <div className="ui-page">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="ui-card ui-card-pad mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("title")}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {t("subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2 justify-end">
              <div className="ui-field min-w-[10rem]">
                <label className="ui-label" htmlFor="calendar-platform">{t("platformFilter")}</label>
                <select
                  id="calendar-platform"
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value as PlatformFilter)}
                  className="ui-select"
                >
                  <option value="ALL">{t("platformAll")}</option>
                  <option value="PC">{t("platformPc")}</option>
                  <option value="MO">{t("platformMo")}</option>
                </select>
              </div>
              {isAdmin && (
                <Button onClick={handleOpenCreate} variant="primary" className="shadow-medium">
                  {t("addEvent")}
                </Button>
              )}
            </div>
          </div>
        </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">{t("loading")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {[
            { year: currentYear, monthIndex: currentMonthIndex, label: t("monthCurrent") },
            { year: currentYear, monthIndex: currentMonthIndex + 1, label: t("monthNext") },
          ].map(({ year, monthIndex, label }) => (
            <div key={label} className="ui-card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {t("monthHeading", { label, year, month: monthIndex + 1 })}
                </h2>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-2">
                  {WEEKDAY_KEYS.map((k) => (
                    <div key={k}>{t(k)}</div>
                  ))}
                </div>
                <div className="space-y-1">
                  {renderMonthGrid(year, monthIndex).map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1">
                      {week.map((day, di) => {
                        const isPlaceholder = day.getTime() === 0;
                        const dateKey = isPlaceholder ? "" : formatKSTDate(day);
                        const dayEvents = dateKey ? eventsByDate[dateKey] || [] : [];
                        const isToday = dateKey === todayKey;

                        return (
                          <div
                            key={di}
                            className={`min-h-[80px] rounded-lg p-1.5 text-sm ${
                              isPlaceholder
                                ? "bg-slate-50/50"
                                : isToday
                                ? "bg-blue-50 ring-1 ring-blue-200"
                                : "bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700"
                            }`}
                          >
                            {!isPlaceholder && (
                              <>
                                <div className={`font-medium mb-1 ${isToday ? "text-blue-700" : "text-slate-700"}`}>
                                  {day.getDate()}
                                </div>
                                <div className="space-y-0.5">
                                  {dayEvents.map((ev) => (
                                    <button
                                      key={ev.id}
                                      type="button"
                                      onClick={() => (isAdmin ? handleEditEvent(ev) : handleViewEvent(ev))}
                                      className={`w-full text-left truncate px-1.5 py-0.5 rounded text-xs ui-focus-ring ${
                                        ev.platform === "PC"
                                          ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                                          : "bg-green-100 text-green-800 hover:bg-green-200"
                                      }`}
                                      title={ev.title}
                                    >
                                      {ev.title}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 이벤트 등록/수정 모달 */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="ui-card ui-card-pad max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
              {editingId ? t("dialogEdit") : t("dialogCreate")}
            </h3>
            <form onSubmit={(e) => handleSaveEvent(e)} className="space-y-3">
              <div>
                <label className="ui-label">{t("platformCode")}</label>
                <select
                  value={formData.platform}
                  onChange={(e) => setFormData({ ...formData, platform: e.target.value as "PC" | "MO" })}
                  className="ui-select"
                >
                  <option value="PC">{t("platformPc")}</option>
                  <option value="MO">{t("platformMo")}</option>
                </select>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="allDay"
                  checked={formData.allDay}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData({
                      ...formData,
                      allDay: checked,
                      startTime: checked ? "00:00" : formData.startTime || "09:00",
                      endTime: checked ? "23:59" : formData.endTime || "18:00",
                      endDate: checked ? formData.startDate : formData.endDate,
                    });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="allDay" className="text-sm font-medium text-slate-700">{t("allDay")}</label>
              </div>
              {formData.allDay ? (
                <div>
                  <label className="ui-label">{t("date")}</label>
                  <LocalizedDateInput
                    type="date"
                    value={formData.startDate}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFormData({ ...formData, startDate: v, endDate: v });
                    }}
                    className="ui-input"
                  />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="ui-label">{t("startDate")}</label>
                      <LocalizedDateInput
                        type="date"
                        value={formData.startDate}
                        min={minDate}
                        max={maxDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        className="ui-input"
                      />
                    </div>
                    <div>
                      <label className="ui-label">{t("startTime")}</label>
                      <input
                        type="time"
                        value={formData.startTime}
                        onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                        className="ui-input"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="ui-label">{t("endDate")}</label>
                      <LocalizedDateInput
                        type="date"
                        value={formData.endDate}
                        min={formData.startDate || minDate}
                        max={maxDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                        className="ui-input"
                      />
                    </div>
                    <div>
                      <label className="ui-label">{t("endTime")}</label>
                      <input
                        type="time"
                        value={formData.endTime}
                        onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                        className="ui-input"
                      />
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="ui-label">{t("titleLabel")}</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={t("titlePlaceholder")}
                  className="ui-input"
                />
              </div>
              <div>
                <label className="ui-label">{t("link")}</label>
                <input
                  type="text"
                  value={formData.link}
                  onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                  placeholder={t("linkPlaceholder")}
                  className="ui-input"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">{t("workAlerts")}</div>
                <div className="space-y-2">
                  <div>
                    <label className="ui-label">{t("lineTarget")}</label>
                    <select
                      value={formData.lineChannelId}
                      onChange={(e) => setFormData({ ...formData, lineChannelId: e.target.value })}
                      className="ui-select"
                      disabled={loadingLineTargets}
                    >
                      <option value="">{loadingLineTargets ? t("lineLoading") : t("lineNone")}</option>
                      {lineTargets.map((t) => (
                        <option key={t.targetId} value={t.targetId}>
                          {String(t.displayName || "").trim()
                            ? `[${String(t.displayName || "").trim()}]`
                            : t.name && String(t.name).trim()
                              ? `[${String(t.name).trim()}]`
                              : `[${t.type}] ${String(t.targetId).slice(0, 8)}…`}
                        </option>
                      ))}
                    </select>
                    <p className="ui-hint mt-1">{t("lineHint")}</p>
                  </div>

                  <div>
                    <label className="ui-label">{t("discordWebhook")}</label>
                    <select
                      value={formData.discordWebhookUrl}
                      onChange={(e) => setFormData({ ...formData, discordWebhookUrl: e.target.value })}
                      className="ui-select"
                    >
                      {DISCORD_WEBHOOK_OPTIONS.map((o) => (
                        <option key={o.id} value={o.url}>
                          {o.id === "none" ? t("discordNone") : o.id === "banAppeal" ? t("discordBanAppeal") : t("discordOdds")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="ui-label">{t("discordMention")}</label>
                    <input
                      type="text"
                      value={formData.discordMention}
                      onChange={(e) => setFormData({ ...formData, discordMention: e.target.value })}
                      className="ui-input"
                      placeholder={t("discordMentionPlaceholder")}
                    />
                  </div>

                  <div>
                    <label className="ui-label">{t("extraMessage")}</label>
                    <textarea
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="ui-textarea"
                      rows={3}
                      placeholder={t("extraMessagePlaceholder")}
                    />
                  </div>

                  <p className="ui-hint">
                    {t("workAlertHint")}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <div>
                  {editingId && isAdmin && (
                    <Button
                      type="button"
                      onClick={() => handleDeleteEvent(editingId)}
                      variant="danger"
                      size="sm"
                    >
                      {t("delete")}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      setIsDialogOpen(false);
                      setFormData(INITIAL_FORM);
                      setEditingId(null);
                    }}
                    variant="outline"
                    size="sm"
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    variant="primary"
                    size="sm"
                  >
                    {saving ? t("saving") : t("save")}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 이벤트 상세 보기 모달 */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="ui-card ui-card-pad max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{t("detailTitle")}</h3>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-slate-500">{t("fieldPlatform")}</span> {selectedEvent.platform}
              </p>
              <p>
                <span className="text-slate-500">{t("fieldStart")}</span>{" "}
                {formatKSTDateTime(new Date(selectedEvent.startDate), dateLocale)}
              </p>
              <p>
                <span className="text-slate-500">{t("fieldEnd")}</span>{" "}
                {formatKSTDateTime(new Date(selectedEvent.endDate), dateLocale)}
              </p>
              <p>
                <span className="text-slate-500">{t("fieldTitle")}</span> {selectedEvent.title}
              </p>
              {selectedEvent.link && (
                <p>
                  <span className="text-slate-500">{t("fieldLink")}</span>{" "}
                  <a
                    href={selectedEvent.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {selectedEvent.link}
                  </a>
                </p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {isAdmin && (
                <>
                  <Button
                    onClick={() => {
                      handleEditEvent(selectedEvent);
                      setSelectedEvent(null);
                    }}
                    variant="ghost"
                    size="sm"
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    onClick={() => {
                      handleDeleteEvent();
                    }}
                    variant="danger"
                    size="sm"
                  >
                    {t("delete")}
                  </Button>
                </>
              )}
              <Button
                onClick={() => setSelectedEvent(null)}
                variant="outline"
                size="sm"
              >
                {t("close")}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
