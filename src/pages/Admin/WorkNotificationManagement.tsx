import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

interface WorkNotification {
  id: string;
  workName: string;
  repeatType: "daily" | "weekly" | "monthly" | "specific" | "interval";
  notificationDate?: string | null;
  notificationTime: string;
  startDate?: string | null;
  endDate?: string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  intervalMinutes?: number | null;
  windowStartTime?: string | null;
  windowEndTime?: string | null;
  lineChannelId: string;
  discordWebhookUrl?: string | null;
  discordMention?: string | null;
  message?: string | null;
  isActive: boolean;
  lastSentDate?: string | null;
  lastSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

const REPEAT_TYPE_VALUES = ["specific", "daily", "weekly", "monthly", "interval"] as const;

const DAY_OF_WEEK_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;

/** Discord 웹훅 선택지 (i18n label keys ↔ URL) */
const DISCORD_WEBHOOK_OPTIONS: { labelKey: string; url: string }[] = [
  {
    labelKey: "admin.workNotification.discordWebhooks.banRequest",
    url: "https://discord.com/api/webhooks/1467767582663774323/uEkyOOa_mYguN2ABNatfZJiErB-GKbgY19w9Cv3SNf2ZDNxMEt0Oqit0atXK2825N1CW",
  },
  {
    labelKey: "admin.workNotification.discordWebhooks.oddsTable",
    url: "https://discord.com/api/webhooks/1467768269355225316/nADmAdJIdETR1wIwSUV2AV8dqzcVx9jIdx3uTYrj7yo_fcSbqWxS0Q0kq1VIS-bCKHW-",
  },
];

function parseDiscordMention(mention: string | null | undefined): { preset: string; id: string } {
  const m = (mention || "").trim();
  if (!m) return { preset: "", id: "" };
  if (m === "@everyone" || m === "@here") return { preset: m, id: "" };
  const userMatch = m.match(/^<@(\d+)>$/);
  if (userMatch) return { preset: "__user__", id: userMatch[1] };
  const roleMatch = m.match(/^<@&(\d+)>$/);
  if (roleMatch) return { preset: "__role__", id: roleMatch[1] };
  return { preset: "", id: "" };
}

interface LineTarget {
  id: string;
  type: string;
  targetId: string;
  name?: string | null;
  displayName?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
}

export default function WorkNotificationManagement() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token, user } = useAuth();
  const [notifications, setNotifications] = useState<WorkNotification[]>([]);
  const [lineTargets, setLineTargets] = useState<LineTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [_loadingTargets, setLoadingTargets] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingNotification, setEditingNotification] = useState<WorkNotification | null>(null);
  const [formData, setFormData] = useState({
    workName: "",
    repeatType: "specific" as "daily" | "weekly" | "monthly" | "specific" | "interval",
    notificationDate: "",
    notificationTime: "",
    startDate: "",
    endDate: "",
    dayOfWeek: null as number | null,
    dayOfMonth: null as number | null,
    intervalMinutes: 30 as number,
    windowStartTime: "09:00",
    windowEndTime: "18:00",
    lineChannelId: "",
    discordWebhookUrl: "",
    discordMention: "",
    discordMentionId: "",
    message: "",
    isActive: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [additionalTimes, setAdditionalTimes] = useState<string[]>([]); // "하루에 여러 번" 등록용 (생성 시에만 사용)
  const [lineUsage, setLineUsage] = useState<{ thisMonthSent: number; lastSentAt: string | null; sentByDay?: Record<string, number>; note: string } | null>(null);
  const [pendingInfo, setPendingInfo] = useState<{ pendingCount: number; currentKstDate: string; currentKstTime: string; pending: WorkNotification[] } | null>(null);
  const [showLineLabelModal, setShowLineLabelModal] = useState(false);
  const [lineLabelEdits, setLineLabelEdits] = useState<Record<string, string>>({});

  const locale = i18n.language?.toLowerCase().startsWith("ko") ? "ko-KR" : "en-US";

  const lineChannelLabel = t("admin.workNotification.lineChannelLabel");

  const discordLabelForUrl = (url: string | null | undefined): string => {
    if (!url?.trim()) return "";
    const found = DISCORD_WEBHOOK_OPTIONS.find((o) => o.url === url.trim());
    return found ? t(found.labelKey) : t("admin.workNotification.webhookConfigured");
  };

  const repeatTypeLabel = (repeatType: string) =>
    t(`admin.workNotification.repeatTypeLabels.${repeatType}`, {
      defaultValue: t("admin.workNotification.repeatTypeLabels.unknown"),
    });

  const scheduleRangeParen = (n: WorkNotification) => {
    const tail = n.endDate
      ? t("admin.workNotification.scheduleDesc.until", { end: n.endDate })
      : t("admin.workNotification.scheduleDesc.openEnded");
    return `(${n.startDate || ""}${tail})`;
  };

  const getScheduleDescription = (notification: WorkNotification) => {
    switch (notification.repeatType) {
      case "daily":
        return t("admin.workNotification.scheduleDesc.daily", {
          time: notification.notificationTime,
          range: scheduleRangeParen(notification),
        });
      case "weekly": {
        const dw = notification.dayOfWeek ?? 0;
        const dayLabel = t(`admin.workNotification.weekdays.${dw}`);
        return t("admin.workNotification.scheduleDesc.weekly", {
          day: dayLabel,
          time: notification.notificationTime,
          range: scheduleRangeParen(notification),
        });
      }
      case "monthly":
        return t("admin.workNotification.scheduleDesc.monthly", {
          day: notification.dayOfMonth ?? 0,
          time: notification.notificationTime,
          range: scheduleRangeParen(notification),
        });
      case "interval":
        return t("admin.workNotification.scheduleDesc.interval", {
          minutes: notification.intervalMinutes || 0,
          start: notification.windowStartTime || "00:00",
          end: notification.windowEndTime || "23:59",
          range: scheduleRangeParen(notification),
        });
      case "specific":
        return t("admin.workNotification.scheduleDesc.specific", {
          date: notification.notificationDate || "",
          time: notification.notificationTime,
        });
      default:
        return "";
    }
  };

  const buildDiscordMentionForSubmit = () => {
    // Discord가 선택되지 않았으면 멘션도 저장/전송하지 않음
    if (!formData.discordWebhookUrl?.trim()) return null;
    const preset = (formData.discordMention || "").trim();
    if (!preset) return null;
    if (preset === "@everyone" || preset === "@here") return preset;
    const id = (formData.discordMentionId || "").trim();
    if (!id) return null;
    if (preset === "__user__") return `<@${id}>`;
    if (preset === "__role__") return `<@&${id}>`;
    // fallback: 이미 멘션 문자열이 들어온 경우 그대로 사용
    return preset;
  };

  useEffect(() => {
    if (token && (user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN")) {
      loadNotifications();
      loadLineTargets();
      loadLineUsage();
      loadPendingInfo();
    }
  }, [token, user]);

  const loadPendingInfo = async () => {
    try {
      const headers = createAuthHeaders(token);
      const res = await fetch("/api/work-notifications/pending", { headers });
      if (res.ok) {
        const data = await res.json();
        setPendingInfo(data.data ?? null);
      } else {
        setPendingInfo(null);
      }
    } catch {
      setPendingInfo(null);
    }
  };

  const loadLineUsage = async () => {
    try {
      const headers = createAuthHeaders(token);
      const res = await fetch("/api/line/usage", { headers });
      if (res.ok) {
        const data = await res.json();
        setLineUsage(data.data ?? null);
      }
    } catch {
      setLineUsage(null);
    }
  };

  const loadLineTargets = async () => {
    setLoadingTargets(true);
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch("/api/line/targets?type=group", { headers });
      if (response.ok) {
        const data = await response.json();
        console.log("Line targets loaded:", data);
        setLineTargets(data.data || []);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("Failed to load line targets:", response.status, errorData);
      }
    } catch (error) {
      console.error("Failed to load line targets:", error);
    } finally {
      setLoadingTargets(false);
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch("/api/work-notifications", { headers });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.data || []);
      } else {
        console.error("Failed to load notifications");
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingNotification(null);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    setFormData({
      workName: "",
      repeatType: "specific",
      notificationDate: today,
      notificationTime: currentTime,
      startDate: today,
      endDate: "",
      dayOfWeek: null,
      dayOfMonth: null,
      intervalMinutes: 30,
      windowStartTime: "09:00",
      windowEndTime: "18:00",
      lineChannelId: "",
      discordWebhookUrl: "",
      discordMention: "",
      discordMentionId: "",
      message: "",
      isActive: true
    });
    setAdditionalTimes([]);
    setShowForm(true);
  };

  const handleEdit = (notification: WorkNotification) => {
    setEditingNotification(notification);
    setFormData({
      workName: notification.workName,
      repeatType: notification.repeatType,
      notificationDate: notification.notificationDate || "",
      notificationTime: notification.notificationTime,
      startDate: notification.startDate || "",
      endDate: notification.endDate || "",
      dayOfWeek: notification.dayOfWeek ?? null,
      dayOfMonth: notification.dayOfMonth ?? null,
      intervalMinutes: notification.intervalMinutes ?? 30,
      windowStartTime: notification.windowStartTime || "09:00",
      windowEndTime: notification.windowEndTime || "18:00",
      lineChannelId: notification.lineChannelId || "",
      discordWebhookUrl: notification.discordWebhookUrl || "",
      discordMention: parseDiscordMention(notification.discordMention).preset,
      discordMentionId: parseDiscordMention(notification.discordMention).id,
      message: notification.message || "",
      isActive: notification.isActive
    });
    setAdditionalTimes([]);
    setShowForm(true);
  };

  const handleCopy = (notification: WorkNotification) => {
    // 기존 알림을 복사해 "새 알림"으로 등록할 수 있도록 폼에 채움 (ID는 새로 생성됨)
    setEditingNotification(null);
    setFormData({
      workName: notification.workName,
      repeatType: notification.repeatType,
      notificationDate: notification.notificationDate || "",
      notificationTime: notification.notificationTime,
      startDate: notification.startDate || "",
      endDate: notification.endDate || "",
      dayOfWeek: notification.dayOfWeek ?? null,
      dayOfMonth: notification.dayOfMonth ?? null,
      intervalMinutes: notification.intervalMinutes ?? 30,
      windowStartTime: notification.windowStartTime || "09:00",
      windowEndTime: notification.windowEndTime || "18:00",
      lineChannelId: notification.lineChannelId || "",
      discordWebhookUrl: notification.discordWebhookUrl || "",
      discordMention: parseDiscordMention(notification.discordMention).preset,
      discordMentionId: parseDiscordMention(notification.discordMention).id,
      message: notification.message || "",
      isActive: notification.isActive
    });
    setAdditionalTimes([]);
    setShowForm(true);
  };

  const handleDelete = async (notificationId: string) => {
    if (!confirm(t("admin.workNotification.deleteConfirm"))) return;

    setDeleting(notificationId);
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch(`/api/work-notifications/${notificationId}`, {
        method: "DELETE",
        headers,
      });

      if (response.ok) {
        await loadNotifications();
      } else {
        const error = await response.json();
        alert(
          t("admin.workNotification.deleteFailed", {
            message: error.message || t("admin.alerts.unknownError"),
          })
        );
      }
    } catch (error) {
      console.error("Failed to delete notification:", error);
      alert(t("admin.workNotification.deleteError"));
    } finally {
      setDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const hasLine = formData.lineChannelId?.trim();
    const hasDiscord = formData.discordWebhookUrl?.trim();
    if (!formData.workName) {
      alert(t("admin.workNotification.alertWorkName"));
      return;
    }
    if (!hasLine && !hasDiscord) {
      alert(t("admin.workNotification.alertChannelRequired"));
      return;
    }

    if (hasDiscord && (formData.discordMention === "__user__" || formData.discordMention === "__role__")) {
      if (!formData.discordMentionId?.trim()) {
        alert(
          formData.discordMention === "__user__"
            ? t("admin.workNotification.alertDiscordUserId")
            : t("admin.workNotification.alertDiscordRoleId")
        );
        return;
      }
    }

    if (formData.repeatType === "specific" && !formData.notificationDate) {
      alert(t("admin.workNotification.alertSpecificDate"));
      return;
    }

    if (
      (formData.repeatType === "daily" ||
        formData.repeatType === "weekly" ||
        formData.repeatType === "monthly" ||
        formData.repeatType === "interval") &&
      !formData.startDate
    ) {
      alert(t("admin.workNotification.alertStartDate"));
      return;
    }

    if (formData.repeatType === "weekly" && formData.dayOfWeek === null) {
      alert(t("admin.workNotification.alertWeekday"));
      return;
    }

    if (formData.repeatType === "monthly" && formData.dayOfMonth === null) {
      alert(t("admin.workNotification.alertDayOfMonth"));
      return;
    }

    if (formData.repeatType === "interval") {
      if (!formData.intervalMinutes || formData.intervalMinutes <= 0) {
        alert(t("admin.workNotification.alertIntervalMinutes"));
        return;
      }
      if (!formData.windowStartTime || !formData.windowEndTime) {
        alert(t("admin.workNotification.alertTimeWindow"));
        return;
      }
      if (!formData.notificationTime) {
        setFormData((prev) => ({ ...prev, notificationTime: prev.windowStartTime }));
      }
    } else {
      if (!formData.notificationTime) {
        alert(t("admin.workNotification.alertTime"));
        return;
      }
    }

    setSubmitting(true);
    try {
      const headers = createAuthHeaders(token) || {};

      // 생성 모드 + 추가 시간들이 있는 경우: 동일 설정으로 시간을 여러 개 생성
      if (!editingNotification && formData.repeatType !== "interval" && additionalTimes.length > 0) {
        const times = Array.from(new Set([formData.notificationTime, ...additionalTimes])).filter(Boolean);
        const errors: string[] = [];

        for (const timeStr of times) {
          const res = await fetch("/api/work-notifications", {
            method: "POST",
            headers: {
              ...(headers as any),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...formData,
              notificationTime: timeStr,
              discordMention: buildDiscordMentionForSubmit(),
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            errors.push(
              `${timeStr}: ${body.message || body.error || t("admin.workNotification.saveFailedShort")}`
            );
          }
        }

        if (errors.length > 0) {
          alert(
            t("admin.workNotification.bulkSaveFailed", {
              errors: errors.slice(0, 5).join("\n"),
              more:
                errors.length > 5
                  ? t("admin.workNotification.bulkSaveMore", { n: errors.length - 5 })
                  : "",
            })
          );
        } else {
          setShowForm(false);
        }
        await loadNotifications();
        return;
      }

      const url = editingNotification
        ? `/api/work-notifications/${editingNotification.id}`
        : "/api/work-notifications";

      const method = editingNotification ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          ...(headers as any),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...formData,
          discordMention: buildDiscordMentionForSubmit()
        })
      });

      if (response.ok) {
        setShowForm(false);
        await loadNotifications();
      } else {
        const error = await response.json();
        alert(
          t("admin.workNotification.saveFailed", {
            message: error.message || t("admin.alerts.unknownError"),
          })
        );
      }
    } catch (error) {
      console.error("Failed to save notification:", error);
      alert(t("admin.workNotification.saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{t("admin.workNotification.title")}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t("admin.workNotification.subtitle")}</p>
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t("admin.workNotification.addNotification")}
        </button>
      </div>

      {/* LINE API 사용량 (앱 기준) */}
      {lineUsage !== null && (
        <div className="mb-6 p-4 rounded-lg border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-600">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            {t("admin.workNotification.lineUsageTitle")}
          </h2>
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
            <span>
              <strong className="text-slate-800 dark:text-slate-200">{t("admin.workNotification.lineUsageThisMonth")}</strong>{" "}
              {lineUsage.thisMonthSent} {t("admin.workNotification.lineUsageCountSuffix")}
            </span>
            <span className="text-slate-500 dark:text-slate-500">{t("admin.workNotification.lineUsageQuotaNote")}</span>
            {lineUsage.lastSentAt && (
              <span>
                <strong className="text-slate-800 dark:text-slate-200">{t("admin.workNotification.lineUsageLastSent")}</strong>{" "}
                {new Date(lineUsage.lastSentAt).toLocaleString(locale)}
              </span>
            )}
          </div>
          {lineUsage.sentByDay && Object.keys(lineUsage.sentByDay).length > 0 && (
            <div className="mt-2 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {t("admin.workNotification.lineUsageByDate")}
              </span>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
                {Object.entries(lineUsage.sentByDay)
                  .sort(([a], [b]) => b.localeCompare(a, i18n.language))
                  .slice(0, 31)
                  .map(([date, count]) => (
                    <li key={date}>
                      {date}: {count} {t("admin.workNotification.lineUsageCountSuffix")}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">{lineUsage.note}</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t("admin.workNotification.lineUsageQuotaWarning")}</p>
          <a
            href="https://manager.line.biz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
          >
            {t("admin.workNotification.lineManagerLink")}
          </a>
        </div>
      )}

      {/* 등록 현황 요약 (전송 건수 원인 파악용) */}
      {notifications.length > 0 && (
        <div className="mb-6 p-4 rounded-lg border bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            {t("admin.workNotification.summaryTitle")}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-500 mb-2">{t("admin.workNotification.summaryHint")}</p>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {t("admin.workNotification.summaryTotalActive")}{" "}
              </span>
              <span className="text-slate-600 dark:text-slate-400">
                {t("admin.workNotification.summaryActiveCount", {
                  n: notifications.filter((n) => n.isActive).length,
                })}
              </span>
              <span className="text-slate-500 dark:text-slate-500">
                {t("admin.workNotification.summaryRegistered", { n: notifications.length })}
              </span>
            </div>
            {(() => {
              const byType: Record<string, WorkNotification[]> = {};
              notifications.forEach((n) => {
                const rt = n.repeatType || "unknown";
                if (!byType[rt]) byType[rt] = [];
                byType[rt].push(n);
              });
              return (
                <>
                  {Object.entries(byType).map(([type, list]) => (
                    <div key={type}>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {repeatTypeLabel(type)}{" "}
                      </span>
                      <span className="text-slate-600 dark:text-slate-400">
                        {t("admin.workNotification.summaryRulesCount", { n: list.length })}
                      </span>
                      {type === "specific" && list.length > 0 && (
                        <ul className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                          {Object.entries(
                            list.reduce<Record<string, number>>((acc, n) => {
                              const d = n.notificationDate || t("admin.workNotification.unsetDate");
                              acc[d] = (acc[d] || 0) + 1;
                              return acc;
                            }, {})
                          )
                            .sort(([a], [b]) => a.localeCompare(b, i18n.language))
                            .map(([date, count]) => (
                              <li key={date}>
                                {t("admin.workNotification.summarySpecificLine", { date, count })}
                              </li>
                            ))}
                        </ul>
                      )}
                      {type === "interval" && list.length > 0 && (
                        <ul className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                          {Object.entries(
                            list.reduce<Record<number, number>>((acc, n) => {
                              const m = n.intervalMinutes ?? 0;
                              acc[m] = (acc[m] || 0) + 1;
                              return acc;
                            }, {})
                          ).map(([minutes, count]) => (
                            <li key={minutes}>
                              {t("admin.workNotification.summaryIntervalLine", {
                                minutes,
                                count,
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* 현재 KST 기준 전송 대기 (시간 반영 검증용) */}
      {pendingInfo !== null && (
        <div className="mb-6 p-4 rounded-lg border bg-sky-50/50 dark:bg-sky-900/10 border-sky-200 dark:border-sky-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            {t("admin.workNotification.pendingTitle")}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-500 mb-2">{t("admin.workNotification.pendingHint")}</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              <strong className="text-slate-800 dark:text-slate-200">{t("admin.workNotification.pendingClock")}</strong>{" "}
              {pendingInfo.currentKstDate} {pendingInfo.currentKstTime}
            </span>
            <span>
              <strong className="text-slate-800 dark:text-slate-200">{t("admin.workNotification.pendingCount")}</strong>{" "}
              {pendingInfo.pendingCount} {t("admin.workNotification.lineUsageCountSuffix")}
            </span>
            <button
              type="button"
              onClick={loadPendingInfo}
              className="text-xs px-2 py-1 rounded bg-sky-200 dark:bg-sky-700 text-sky-800 dark:text-sky-200 hover:bg-sky-300 dark:hover:bg-sky-600"
            >
              {t("admin.workNotification.refresh")}
            </button>
          </div>
          {pendingInfo.pendingCount > 0 && (
            <ul className="mt-2 text-xs text-slate-600 dark:text-slate-400 list-disc list-inside">
              {pendingInfo.pending.map((n) => (
                <li key={n.id}>
                  {n.workName} · {n.notificationTime} · {repeatTypeLabel(n.repeatType)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 알림 목록 */}
      {loading ? (
        <div className="text-center py-8 text-slate-600 dark:text-slate-400">{t("admin.workNotification.loading")}</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-8 text-slate-600 dark:text-slate-400">{t("admin.workNotification.empty")}</div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-4 rounded-lg border ${
                !notification.isActive
                  ? "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                  : "bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200">
                      {notification.workName}
                    </h3>
                    <span className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                      {repeatTypeLabel(notification.repeatType)}
                    </span>
                    {!notification.isActive && (
                      <span className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-full">
                        {t("admin.workNotification.inactive")}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <div>
                      <span className="font-medium">{t("admin.workNotification.schedule")}</span>{" "}
                      {getScheduleDescription(notification)}
                    </div>
                    {notification.lineChannelId && (
                      <div>
                        <span className="font-medium">{t("admin.workNotification.line")}</span> {lineChannelLabel}
                      </div>
                    )}
                    {notification.discordWebhookUrl && (
                      <div>
                        <span className="font-medium">{t("admin.workNotification.discord")}</span>{" "}
                        {discordLabelForUrl(notification.discordWebhookUrl)}
                      </div>
                    )}
                    {notification.message && (
                      <div>
                        <span className="font-medium">{t("admin.workNotification.message")}</span> {notification.message}
                      </div>
                    )}
                    {notification.lastSentDate && (
                      <div>
                        <span className="font-medium">{t("admin.workNotification.lastSent")}</span>{" "}
                        {notification.lastSentDate}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(notification)}
                    className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    {t("admin.workNotification.edit")}
                  </button>
                  <button
                    onClick={() => handleCopy(notification)}
                    className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    title={t("admin.workNotification.copyTitle")}
                  >
                    {t("admin.workNotification.copy")}
                  </button>
                  <button
                    onClick={() => handleDelete(notification.id)}
                    disabled={deleting === notification.id}
                    className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                  >
                    {deleting === notification.id ? t("admin.workNotification.deleting") : t("admin.workNotification.delete")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 등록/수정 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200">
              {editingNotification ? t("admin.workNotification.formEdit") : t("admin.workNotification.formCreate")}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.fieldWorkName")} *
                </label>
                <input
                  type="text"
                  value={formData.workName}
                  onChange={(e) => setFormData({ ...formData, workName: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.fieldRepeatType")} *
                </label>
                <select
                  value={formData.repeatType}
                  onChange={(e) => setFormData({ ...formData, repeatType: e.target.value as any })}
                  className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  required
                >
                  {REPEAT_TYPE_VALUES.map((rt) => (
                    <option key={rt} value={rt}>
                      {repeatTypeLabel(rt)}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* 특정 날짜 */}
              {formData.repeatType === "specific" && (
                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                    {t("admin.workNotification.dateSpecific")} * {t("admin.workNotification.dateSpecificHint")}
                  </label>
                  <LocalizedDateInput
                    type="date"
                    value={formData.notificationDate}
                    onChange={(e) => setFormData({ ...formData, notificationDate: e.target.value })}
                    className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    required
                  />
                </div>
              )}

              {/* 반복 스케줄: 시작/종료 날짜 */}
              {(formData.repeatType === "daily" ||
                formData.repeatType === "weekly" ||
                formData.repeatType === "monthly" ||
                formData.repeatType === "interval") && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                      {t("admin.workNotification.startDate")} * {t("admin.workNotification.startDateHint")}
                    </label>
                    <LocalizedDateInput
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                      {t("admin.workNotification.endDate")} {t("admin.workNotification.endDateHint")}
                    </label>
                    <LocalizedDateInput
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    />
                  </div>
                </>
              )}

              {/* 매주: 요일 선택 */}
              {formData.repeatType === "weekly" && (
                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                    {t("admin.workNotification.fieldWeekday")} *
                  </label>
                  <select
                    value={formData.dayOfWeek ?? ""}
                    onChange={(e) =>
                      setFormData({ ...formData, dayOfWeek: e.target.value ? parseInt(e.target.value, 10) : null })
                    }
                    className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    required
                  >
                    <option value="">{t("admin.workNotification.selectPlaceholder")}</option>
                    {DAY_OF_WEEK_VALUES.map((d) => (
                      <option key={d} value={d}>
                        {t(`admin.workNotification.weekdays.${d}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 매월: 일자 선택 */}
              {formData.repeatType === "monthly" && (
                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                    {t("admin.workNotification.fieldDayOfMonth")} * {t("admin.workNotification.dayOfMonthHint")}
                  </label>
                  <select
                    value={formData.dayOfMonth ?? ""}
                    onChange={(e) =>
                      setFormData({ ...formData, dayOfMonth: e.target.value ? parseInt(e.target.value, 10) : null })
                    }
                    className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    required
                  >
                    <option value="">{t("admin.workNotification.selectPlaceholder")}</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        {day}
                        {t("admin.workNotification.daySuffix")}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.fieldTime")} * {t("admin.workNotification.timeHint")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={formData.notificationTime}
                    onChange={(e) => setFormData({ ...formData, notificationTime: e.target.value })}
                    className="flex-1 px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    required={formData.repeatType !== "interval"}
                    disabled={formData.repeatType === "interval"}
                  />
                {!editingNotification && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!formData.notificationTime) return;
                      const slot = formData.notificationTime;
                      if (additionalTimes.includes(slot)) return;
                      setAdditionalTimes((prev) => [...prev, slot]);
                    }}
                    className="h-[42px] w-[42px] rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors flex items-center justify-center"
                    title={t("admin.workNotification.addTimeTitle")}
                    disabled={formData.repeatType === "interval"}
                  >
                    <span className="text-lg leading-none">＋</span>
                  </button>
                )}
                </div>
                {!editingNotification && (
                  <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        <span className="font-semibold">{t("admin.workNotification.additionalTimesLabel")}</span>
                        <span className="text-slate-400 dark:text-slate-500">
                          {" "}
                          {t("admin.workNotification.additionalTimesOptional")}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t("admin.workNotification.additionalTimesHint")}
                      </div>
                    </div>
                    {additionalTimes.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {additionalTimes.map((slot) => (
                          <span
                            key={slot}
                            className="inline-flex items-center gap-2 px-3 py-1 text-xs rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 shadow-sm"
                          >
                            <span className="font-medium">{slot}</span>
                            <button
                              type="button"
                              onClick={() => setAdditionalTimes((prev) => prev.filter((x) => x !== slot))}
                              className="h-5 w-5 rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center"
                              title={t("admin.workNotification.removeTime")}
                            >
                              <span className="text-[12px] leading-none">×</span>
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {t("admin.workNotification.additionalTimesEmpty")}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 간격(매 N분) */}
              {formData.repeatType === "interval" && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 p-4 space-y-3">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t("admin.workNotification.intervalSectionTitle")}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                        {t("admin.workNotification.intervalMinutes")}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={formData.intervalMinutes}
                        onChange={(e) => setFormData({ ...formData, intervalMinutes: parseInt(e.target.value || "0", 10) })}
                        className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                        {t("admin.workNotification.windowStart")}
                      </label>
                      <input
                        type="time"
                        value={formData.windowStartTime}
                        onChange={(e) => setFormData({ ...formData, windowStartTime: e.target.value, notificationTime: e.target.value })}
                        className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                        {t("admin.workNotification.windowEnd")}
                      </label>
                      <input
                        type="time"
                        value={formData.windowEndTime}
                        onChange={(e) => setFormData({ ...formData, windowEndTime: e.target.value })}
                        className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{t("admin.workNotification.intervalExample")}</div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.lineFieldLabel", { label: lineChannelLabel })}
                </label>
                {lineTargets.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {t("admin.workNotification.lineLabelHint")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const initial: Record<string, string> = {};
                          for (const lt of lineTargets) {
                            initial[lt.id] = (lt.displayName || lt.name || "").toString();
                          }
                          setLineLabelEdits(initial);
                          setShowLineLabelModal(true);
                        }}
                        className="ml-auto text-xs font-semibold text-blue-600 dark:text-blue-300 hover:underline"
                      >
                        {t("admin.workNotification.lineLabelManage")}
                      </button>
                    </div>
                    <select
                      value={formData.lineChannelId}
                      onChange={(e) => setFormData({ ...formData, lineChannelId: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 mb-2"
                    >
                      <option value="">{t("admin.workNotification.lineNone")}</option>
                      {lineTargets.map((target) => (
                        <option key={target.id} value={target.targetId}>
                          {target.displayName && String(target.displayName).trim()
                            ? `[${String(target.displayName).trim()}]`
                            : target.name && String(target.name).trim()
                              ? `[${String(target.name).trim()}]`
                              : lineChannelLabel}
                          {target.lastSeenAt
                            ? ` ${t("admin.workNotification.lastActivity", {
                                time: new Date(target.lastSeenAt).toLocaleString(locale, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }),
                              })}`
                            : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={formData.lineChannelId}
                      onChange={(e) => setFormData({ ...formData, lineChannelId: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      placeholder={t("admin.workNotification.lineIdPlaceholder")}
                    />
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={formData.lineChannelId}
                      onChange={(e) => setFormData({ ...formData, lineChannelId: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      placeholder={t("admin.workNotification.lineIdPlaceholderEmpty")}
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t("admin.workNotification.lineCollectHint")}
                    </p>
                  </>
                )}
              </div>

              {showLineLabelModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLineLabelModal(false)}>
                  <div
                    className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-2xl p-5 shadow-xl max-h-[80vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {t("admin.workNotification.lineLabelModalTitle")}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowLineLabelModal(false)}
                        className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        {t("admin.workNotification.close")}
                      </button>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                      {t("admin.workNotification.lineLabelModalHint")}
                    </div>

                    <div className="space-y-3">
                      {lineTargets.map((row) => {
                        const current = (lineLabelEdits[row.id] ?? "").toString();
                        const fallback = row.name || "";
                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-1 sm:grid-cols-[1fr,16rem] gap-2 items-start border border-slate-200 dark:border-slate-700 rounded-lg p-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {row.displayName && String(row.displayName).trim()
                                  ? `[${String(row.displayName).trim()}]`
                                  : row.name && String(row.name).trim()
                                    ? `[${String(row.name).trim()}]`
                                    : lineChannelLabel}
                              </div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 break-all">
                                {row.type} · {row.targetId}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={current}
                                onChange={(e) => setLineLabelEdits({ ...lineLabelEdits, [row.id]: e.target.value })}
                                className="flex-1 px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm"
                                placeholder={
                                  fallback
                                    ? t("admin.workNotification.labelPlaceholderWithExample", { name: fallback })
                                    : t("admin.workNotification.labelPlaceholderGeneric")
                                }
                              />
                              <button
                                type="button"
                                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                                onClick={async () => {
                                  try {
                                    const headers = createAuthHeaders(token) ?? {};
                                    const res = await fetch(`/api/line/targets/${encodeURIComponent(row.id)}`, {
                                      method: "PUT",
                                      headers: { ...headers, "Content-Type": "application/json" },
                                      body: JSON.stringify({ displayName: (lineLabelEdits[row.id] ?? "").toString() }),
                                    });
                                    if (!res.ok) {
                                      const body = await res.json().catch(() => ({}));
                                      throw new Error(body.message || `HTTP ${res.status}`);
                                    }
                                    const response = await fetch("/api/line/targets?type=group", { headers });
                                    const data = await response.json().catch(() => ({}));
                                    setLineTargets(data.data || []);
                                  } catch (e: any) {
                                    alert(e?.message || t("admin.workNotification.labelSaveFailed"));
                                  }
                                }}
                              >
                                {t("admin.workNotification.labelSave")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.discordField")}
                </label>
                <select
                  value={formData.discordWebhookUrl}
                  onChange={(e) => setFormData({ ...formData, discordWebhookUrl: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                >
                  <option value="">{t("admin.workNotification.lineNone")}</option>
                  {DISCORD_WEBHOOK_OPTIONS.map((opt) => (
                    <option key={opt.url} value={opt.url}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              {formData.discordWebhookUrl && (
                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                    {t("admin.workNotification.discordMention")}
                  </label>
                  <select
                    value={formData.discordMention}
                    onChange={(e) => setFormData({ ...formData, discordMention: e.target.value, discordMentionId: "" })}
                    className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    <option value="">{t("admin.workNotification.mentionNone")}</option>
                    <option value="@everyone">@everyone</option>
                    <option value="@here">@here</option>
                    <option value="__user__">{t("admin.workNotification.mentionUserOption")}</option>
                    <option value="__role__">{t("admin.workNotification.mentionRoleOption")}</option>
                  </select>
                  {(formData.discordMention === "__user__" || formData.discordMention === "__role__") && (
                    <input
                      type="text"
                      value={formData.discordMentionId}
                      onChange={(e) => setFormData({ ...formData, discordMentionId: e.target.value })}
                      className="w-full mt-2 px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      placeholder={
                        formData.discordMention === "__user__"
                          ? t("admin.workNotification.mentionUserPlaceholder")
                          : t("admin.workNotification.mentionRolePlaceholder")
                      }
                    />
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {t("admin.workNotification.mentionDevHint")}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.extraMessage")}
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  rows={3}
                  placeholder={t("admin.workNotification.extraMessagePlaceholder")}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="isActive" className="text-sm text-slate-700 dark:text-slate-300">
                  {t("admin.workNotification.active")}
                </label>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {submitting ? t("admin.workNotification.saving") : t("admin.workNotification.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  {t("admin.workNotification.cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
