import { useState, useEffect, useCallback, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

interface ChecklistRow {
  id: number;
  title: string;
  sortOrder: number;
  isActive: boolean;
  checked: boolean;
  executionId: number | null;
  checkedAt: string | null;
  url?: string | null;
  daysOfWeek?: string | null;
  workType?: string | null;
}

interface MyChecklistResponse {
  workDate: string;
  workType?: string;
  items: ChecklistRow[];
}

interface AssigneeGroup {
  workType: string;
  users: { id: number; name: string | null; email: string | null }[];
  /** 예약 필드(항상 빈 배열). 과거 수동 지정 API용 */
  manualUserIds?: number[];
  /** 에이전트 스케줄(해당 날짜·작업 구분)에 등록된 계정 id */
  scheduleUserIds?: number[];
}

interface TeamOverviewUser {
  userId: number;
  name: string | null;
  email: string | null;
  checkedCount: number;
  totalItems: number;
  allChecked: boolean;
  itemStatuses: {
    itemId: number;
    title: string;
    checked: boolean;
    checkedAt: string | null;
  }[];
}

interface TeamOverviewResponse {
  workDate: string;
  workType: string | null;
  totalItems: number;
  items: { itemId: number; title: string }[];
  users: TeamOverviewUser[];
}

interface StepFloatingItem {
  id: number;
  title: string;
  content: string;
  position: "left" | "right";
  sortOrder: number;
}

const WORK_TYPE_ALL = "전체";
const WORK_TYPE_VALUES = ["전체", "주간", "오후", "야간", "정오", "PC", "MO"] as const;

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;

async function readApiJson(res: Response) {
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? json;
}

function ContentWithLinks({ text }: { text: string }) {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function ChecklistBlock({
  items,
  title,
  emptyMessage,
  setChecked,
  togglingId,
}: {
  items: ChecklistRow[];
  title: string;
  emptyMessage: string;
  setChecked: (itemId: number, checked: boolean) => void;
  togglingId: number | null;
}) {
  const { t, i18n } = useTranslation("pagesAgent");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";
  if (!items?.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mt-4">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        <div className="p-4 text-center text-sm text-slate-500">{emptyMessage}</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mt-4">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <ul className="divide-y divide-slate-200">
        {items.map((row) => (
          <li key={row.id} className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 text-sm">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={row.checked}
                disabled={togglingId === row.id}
                onChange={(e) => setChecked(row.id, e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span
                className={row.checked ? "min-w-0 truncate text-slate-600 line-through" : "min-w-0 truncate font-medium text-slate-800"}
                title={row.title}
              >
                {row.title}
              </span>
            </label>
            {row.url && (
              <button
                type="button"
                onClick={() => {
                  const u = row.url!.trim();
                  window.open(u.startsWith("http") ? u : `https://${u}`, "_blank", "noopener,noreferrer");
                }}
                className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                title={row.url}
              >
                {t("workChecklist.link")}
              </button>
            )}
            {row.checkedAt && (
              <span className="text-[10px] text-slate-400 shrink-0">
                {new Date(row.checkedAt).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {togglingId === row.id && (
              <span className="text-[10px] text-slate-400 shrink-0">{t("workChecklist.saving")}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        {t("workChecklist.progress", {
          done: items.filter((i) => i.checked).length,
          total: items.length,
        })}
      </div>
    </div>
  );
}

function TeamMiniSummary({
  data,
  loading,
  label,
}: {
  data: TeamOverviewResponse | null;
  loading: boolean;
  label: string;
}) {
  const { t } = useTranslation("pagesAgent");
  if (loading) {
    return (
      <p className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
        {t("workChecklist.loadingLabel", { label })}
      </p>
    );
  }
  if (!data || data.totalItems === 0 || data.users.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] text-slate-700">
      <p className="mb-1 font-semibold text-slate-800">{label}</p>
      <ul className="max-h-36 space-y-0.5 overflow-y-auto">
        {data.users.map((u) => (
          <li key={u.userId} className="flex justify-between gap-2 tabular-nums">
            <span className="min-w-0 truncate" title={u.email || ""}>
              {u.name || u.email || `#${u.userId}`}
            </span>
            <span className="shrink-0 text-slate-600">
              {u.checkedCount}/{u.totalItems}
              {u.allChecked ? " ✓" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepFloatingPanel({ items, label }: { items: StepFloatingItem[]; label: string }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-white/90 shadow-sm overflow-hidden">
      <div className="bg-amber-50 px-3 py-2 border-b border-amber-200">
        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
      </div>
      <div className="divide-y divide-slate-100 max-h-[calc(100vh-220px)] overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="bg-white">
            <button
              type="button"
              onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span className="truncate">{item.title}</span>
              <span className={`shrink-0 ml-2 transition-transform ${expandedId === item.id ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>
            {expandedId === item.id && (
              <div className="px-3 pb-3 pt-0 text-sm text-slate-600 bg-slate-50/50">
                <div className="whitespace-pre-wrap border-l-2 border-amber-300 pl-3">
                  {item.content.split("\n").map((line, i, lines) => (
                    <span key={i}>
                      <ContentWithLinks text={line} />
                      {i < lines.length - 1 && <br />}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkChecklist() {
  const { t, i18n } = useTranslation("pagesAgent");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";
  const { token, user } = useAuth();

  const formatDateLabel = useCallback(
    (d: string) => {
      const date = new Date(d + "T12:00:00");
      const today = new Date();
      const isToday =
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate();
      const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
      const week = t(`workChecklist.weekday.${keys[date.getDay()]}`);
      return isToday ? t("workChecklist.today", { date: d }) : `${d} (${week})`;
    },
    [t]
  );

  const workTypeLabel = useCallback(
    (value: string) => t(`workChecklist.workTypeLabels.${value}` as const),
    [t]
  );
  const [workDate, setWorkDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [workType, setWorkType] = useState<string>(WORK_TYPE_ALL);
  const [data, setData] = useState<MyChecklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [bannerContent, setBannerContent] = useState<string>("");
  const [stepFloatingItems, setStepFloatingItems] = useState<StepFloatingItem[]>([]);
  const [pcChecklistData, setPcChecklistData] = useState<MyChecklistResponse | null>(null);
  const [moChecklistData, setMoChecklistData] = useState<MyChecklistResponse | null>(null);
  const [assignees, setAssignees] = useState<AssigneeGroup[]>([]);
  const [teamOverview, setTeamOverview] = useState<TeamOverviewResponse | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamExpanded, setTeamExpanded] = useState<Record<number, boolean>>({});
  const [pcTeamOverview, setPcTeamOverview] = useState<TeamOverviewResponse | null>(null);
  const [moTeamOverview, setMoTeamOverview] = useState<TeamOverviewResponse | null>(null);
  const [pcMoTeamLoading, setPcMoTeamLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/work-checklist/banner")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const d = json.data ?? json;
        const content = d?.content ?? "";
        if (content.trim()) setBannerContent(content.trim());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadStepFloating = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/step-floating/items", {
        headers: createAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        const items = json.data?.items ?? json?.items ?? [];
        setStepFloatingItems(items);
      }
    } catch (e) {
      console.error("Failed to load step floating", e);
    }
  }, [token]);

  useEffect(() => {
    loadStepFloating();
  }, [loadStepFloating]);

  /** 체크리스트·담당·팀(데스크톱/모바일 점검 포함)을 한 번에 요청해 왕복·리렌더 횟수를 줄임 */
  const fetchChecklistBundle = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      const headers = createAuthHeaders(token);
      const execParams = new URLSearchParams({ date: workDate });
      if (workType && workType !== WORK_TYPE_ALL) execParams.set("workType", workType);
      const pcParams = new URLSearchParams({ date: workDate, workType: "PC" });
      const moParams = new URLSearchParams({ date: workDate, workType: "MO" });
      const assigneeParams = new URLSearchParams({ date: workDate });
      const init: RequestInit = { headers };
      if (signal) init.signal = signal;

      try {
        const [
          execRes,
          pcExecRes,
          moExecRes,
          assigneesRes,
          teamRes,
          pcTeamRes,
          moTeamRes,
        ] = await Promise.all([
          fetch(`/api/work-checklist/executions?${execParams}`, init),
          fetch(`/api/work-checklist/executions?${pcParams}`, init),
          fetch(`/api/work-checklist/executions?${moParams}`, init),
          fetch(`/api/work-checklist/assignees?${assigneeParams}`, init),
          fetch(`/api/work-checklist/executions/team?${execParams}`, init),
          fetch(`/api/work-checklist/executions/team?${pcParams}`, init),
          fetch(`/api/work-checklist/executions/team?${moParams}`, init),
        ]);

        if (signal?.aborted) return;

        const [
          execData,
          pcData,
          moData,
          assignJson,
          teamData,
          pcTeamData,
          moTeamData,
        ] = await Promise.all([
          readApiJson(execRes),
          readApiJson(pcExecRes),
          readApiJson(moExecRes),
          readApiJson(assigneesRes),
          readApiJson(teamRes),
          readApiJson(pcTeamRes),
          readApiJson(moTeamRes),
        ]);

        if (signal?.aborted) return;

        setData(execData as MyChecklistResponse | null);
        setPcChecklistData(pcData as MyChecklistResponse | null);
        setMoChecklistData(moData as MyChecklistResponse | null);
        setAssignees(Array.isArray(assignJson) ? (assignJson as AssigneeGroup[]) : []);
        setTeamOverview(teamData as TeamOverviewResponse | null);
        setPcTeamOverview(pcTeamData as TeamOverviewResponse | null);
        setMoTeamOverview(moTeamData as TeamOverviewResponse | null);
      } catch (e) {
        const aborted =
          e &&
          typeof e === "object" &&
          "name" in e &&
          (e as { name: string }).name === "AbortError";
        if (aborted) return;
        console.error("Failed to load checklist bundle", e);
        if (!signal?.aborted) {
          setData(null);
          setPcChecklistData(null);
          setMoChecklistData(null);
          setTeamOverview(null);
          setPcTeamOverview(null);
          setMoTeamOverview(null);
        }
      }
    },
    [token, workDate, workType]
  );

  useEffect(() => {
    if (!token) return;
    const ac = new AbortController();
    setLoading(true);
    setTeamLoading(true);
    setPcMoTeamLoading(true);
    (async () => {
      try {
        await fetchChecklistBundle(ac.signal);
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
          setTeamLoading(false);
          setPcMoTeamLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [token, workDate, workType, fetchChecklistBundle]);

  const setChecked = async (itemId: number, checked: boolean) => {
    if (!token) return;
    setTogglingId(itemId);
    try {
      const res = await fetch("/api/work-checklist/executions", {
        method: "PUT",
        headers: {
          ...createAuthHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId,
          workDate,
          checked,
        }),
      });
      if (res.ok) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((row) =>
              row.id === itemId
                ? {
                    ...row,
                    checked,
                    checkedAt: checked ? new Date().toISOString() : null,
                  }
                : row
            ),
          };
        });
        await fetchChecklistBundle();
      }
    } catch (e) {
      console.error("Failed to update check", e);
      await fetchChecklistBundle();
    } finally {
      setTogglingId(null);
    }
  };

  if (!user) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-800">
        {t("handover.loginRequired")}
      </div>
    );
  }

  const leftItems = stepFloatingItems.filter((i) => i.position === "left");
  const rightItems = stepFloatingItems.filter((i) => i.position === "right");
  // 가운데 목록에서는 데스크톱·모바일 점검 항목 제외 (사이드에만 표시)
  const centerItems = (data?.items ?? []).filter(
    (row) => row.workType !== "PC" && row.workType !== "MO"
  );

  const checklistContent = (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("workChecklist.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("workChecklist.subtitle")}
        </p>
        {bannerContent && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm">
            <p className="whitespace-pre-wrap font-medium">{bannerContent}</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">{t("workChecklist.date")}</label>
          <LocalizedDateInput
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-500">{formatDateLabel(workDate)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">{t("workChecklist.workType")}</label>
          <select
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {WORK_TYPE_VALUES.map((w) => (
              <option key={w} value={w}>
                {workTypeLabel(w)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {t("workChecklist.workTypeHint")}
          </p>
        </div>
      </div>

      {assignees.some((g) => g.users.length > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">{t("workChecklist.assigneesTitle")}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("workChecklist.assigneesBody")}
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {assignees.map((g) => {
              const active =
                workType !== WORK_TYPE_ALL
                  ? workType === g.workType
                  : false;
              return (
                <div
                  key={g.workType}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    active ? "border-blue-300 bg-blue-50/80" : "border-slate-200 bg-slate-50/60"
                  }`}
                >
                  <dt className="text-xs font-semibold text-slate-600">{workTypeLabel(g.workType)}</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.users.length === 0 ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      g.users.map((u) => (
                        <span
                          key={u.id}
                          className="inline-flex max-w-full truncate rounded-md border border-slate-200 bg-white/90 px-1.5 py-0.5 text-slate-800"
                        >
                          {u.name || u.email || `#${u.id}`}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{t("workChecklist.teamTitle")}</h2>
          <p className="mt-1 text-xs font-normal text-slate-600">{t("workChecklist.teamBody")}</p>
        </div>
        {teamLoading ? (
          <div className="p-6 text-center text-sm text-slate-500">{t("workChecklist.loadingTeam")}</div>
        ) : !teamOverview || teamOverview.totalItems === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            {t("workChecklist.noItemsForTeam")}
          </div>
        ) : teamOverview.users.length === 0 ? (
          <div className="p-6 text-center text-sm text-amber-800">
            {t("workChecklist.noAssignees")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">{t("workChecklist.thName")}</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-700">{t("workChecklist.thChecks")}</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-700">{t("workChecklist.thAllDone")}</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-700">{t("workChecklist.thItems")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamOverview.users.map((u) => (
                  <Fragment key={u.userId}>
                    <tr className="bg-white hover:bg-slate-50/80">
                      <td className="px-3 py-2 text-slate-800">{u.name || u.email || "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-slate-800">
                        {u.checkedCount} / {u.totalItems}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {u.totalItems === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : u.allChecked ? (
                          <span className="font-medium text-emerald-700">{t("workChecklist.yes")}</span>
                        ) : (
                          <span className="font-medium text-amber-800">{t("workChecklist.no")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          disabled={u.totalItems === 0}
                          onClick={() =>
                            setTeamExpanded((prev) => ({ ...prev, [u.userId]: !prev[u.userId] }))
                          }
                          className="text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline text-xs"
                        >
                          {teamExpanded[u.userId] ? t("workChecklist.collapse") : t("workChecklist.expand")}
                        </button>
                      </td>
                    </tr>
                    {teamExpanded[u.userId] && u.totalItems > 0 && (
                      <tr className="bg-slate-50/90">
                        <td colSpan={4} className="px-3 py-2">
                          <ul className="grid gap-1 sm:grid-cols-2">
                            {u.itemStatuses.map((it) => (
                              <li
                                key={it.itemId}
                                className={`flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${
                                  it.checked
                                    ? "border-emerald-200 bg-emerald-50/60 text-slate-800"
                                    : "border-amber-200 bg-amber-50/70 text-slate-800"
                                }`}
                              >
                                <span className="shrink-0 font-semibold">{it.checked ? "✓" : "○"}</span>
                                <span className="min-w-0 flex-1 break-words">{it.title}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-semibold text-slate-800">
            {t("workChecklist.checklistHeading", {
              prefix: `${formatDateLabel(workDate)}${workType !== WORK_TYPE_ALL ? ` · ${workTypeLabel(workType)}` : ""}`,
            })}
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-500">{t("workChecklist.loading")}</div>
        ) : !centerItems.length ? (
          <div className="p-8 text-center text-slate-500">
            {t("workChecklist.noCenterItems")}
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {centerItems.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    disabled={togglingId === row.id}
                    onChange={(e) => setChecked(row.id, e.target.checked)}
                    className="h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span
                    className={
                      row.checked
                        ? "min-w-0 truncate text-slate-600 line-through"
                        : "min-w-0 truncate font-medium text-slate-800"
                    }
                    title={row.title}
                  >
                    {row.title}
                  </span>
                </label>
                {row.url && (
                  <button
                    type="button"
                    onClick={() => {
                      const u = row.url!.trim();
                      const href = u.startsWith("http://") || u.startsWith("https://") ? u : `https://${u}`;
                      window.open(href, "_blank", "noopener,noreferrer");
                    }}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title={row.url}
                  >
                    {t("workChecklist.link")}
                  </button>
                )}
                {row.checkedAt && (
                  <span className="text-xs text-slate-400">
                    {new Date(row.checkedAt).toLocaleTimeString(dateLocale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
                {togglingId === row.id && (
                  <span className="text-xs text-slate-400">{t("workChecklist.saving")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {centerItems.length ? (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
            {t("workChecklist.progress", {
              done: centerItems.filter((i) => i.checked).length,
              total: centerItems.length,
            })}
          </div>
        ) : null}
      </div>
    </div>
  );

  // Step Floating만 있으면 안 되고, 데스크톱/모바일 점검 체크리스트가 있어도(또는 로드되어 빈 목록이어도) 같은 열을 써야 함
  const hasLeft = leftItems.length > 0 || pcChecklistData != null;
  const hasRight = rightItems.length > 0 || moChecklistData != null;
  const hasSidePanels = hasLeft || hasRight;

  return (
    <div className={`flex flex-col lg:flex-row gap-4 w-full ${hasSidePanels ? "lg:gap-6" : ""}`}>
      {hasLeft && (
        <aside className="w-full lg:w-80 xl:w-[22rem] shrink-0 order-2 lg:order-1">
          <div className="lg:sticky lg:top-4 space-y-0">
            <StepFloatingPanel items={leftItems} label={t("workChecklist.stepPc")} />
            <ChecklistBlock
              items={pcChecklistData?.items ?? []}
              title={t("workChecklist.pcChecklistTitle")}
              emptyMessage={t("workChecklist.pcChecklistEmpty")}
              setChecked={setChecked}
              togglingId={togglingId}
            />
            <TeamMiniSummary
              data={pcTeamOverview}
              loading={pcMoTeamLoading}
              label={t("workChecklist.pcAssignees")}
            />
          </div>
        </aside>
      )}
      <main className={`flex-1 min-w-0 order-1 ${hasLeft ? "lg:order-2" : ""} mx-auto max-w-2xl w-full`}>
        {checklistContent}
      </main>
      {hasRight && (
        <aside className="w-full lg:w-80 xl:w-[22rem] shrink-0 order-3">
          <div className="lg:sticky lg:top-4 space-y-0">
            <StepFloatingPanel items={rightItems} label={t("workChecklist.stepMo")} />
            <ChecklistBlock
              items={moChecklistData?.items ?? []}
              title={t("workChecklist.moChecklistTitle")}
              emptyMessage={t("workChecklist.moChecklistEmpty")}
              setChecked={setChecked}
              togglingId={togglingId}
            />
            <TeamMiniSummary
              data={moTeamOverview}
              loading={pcMoTeamLoading}
              label={t("workChecklist.moAssignees")}
            />
          </div>
        </aside>
      )}
    </div>
  );
}
