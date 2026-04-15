import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { Button } from "../../components/ui/Button";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

/** API `workType` values (unchanged for backend). */
const WT_ALL = "전체";
const WT_DEFAULT_OVERVIEW = "주간";

const WORK_TYPE_VALUES = ["전체", "주간", "오후", "야간", "정오", "PC", "MO"] as const;

const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;

interface WorkChecklistItem {
  id: number;
  title: string;
  sortOrder: number;
  isActive: number;
  workType?: string | null;
  showInPC?: number | null;
  showInMO?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  monthsOfYear?: string | null;
  daysOfWeek?: string | null;
  url?: string | null;
  createdAt: string;
  updatedAt: string;
}

function kstTodayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

interface OverviewItemStatus {
  itemId: number;
  title: string;
  checked: boolean;
  checkedAt: string | null;
}

interface OverviewUserRow {
  userId: number;
  name: string | null;
  email: string | null;
  checkedCount: number;
  totalItems: number;
  allChecked: boolean;
  itemStatuses: OverviewItemStatus[];
}

interface ExecutionOverviewData {
  workDate: string;
  workType: string | null;
  totalItems: number;
  items: { itemId: number; title: string }[];
  users: OverviewUserRow[];
}

export default function WorkChecklistManagement() {
  const { t } = useTranslation("pagesAdmin");
  const { token, user } = useAuth();
  const [items, setItems] = useState<WorkChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [filterWorkType, setFilterWorkType] = useState<string>(WT_ALL);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkChecklistItem | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formWorkType, setFormWorkType] = useState<string>(WT_ALL);
  const [formValidFrom, setFormValidFrom] = useState("");
  const [formValidTo, setFormValidTo] = useState("");
  const [formMonths, setFormMonths] = useState<number[]>([]);
  const [formDaysOfWeek, setFormDaysOfWeek] = useState<number[]>([]);
  const [formActive, setFormActive] = useState(true);
  const [formShowInPC, setFormShowInPC] = useState(false);
  const [formShowInMO, setFormShowInMO] = useState(false);
  const [formUrl, setFormUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [orderSaveMessage, setOrderSaveMessage] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [bannerContent, setBannerContent] = useState("");
  const [bannerSaving, setBannerSaving] = useState(false);
  const [bannerSaveMessage, setBannerSaveMessage] = useState<string | null>(null);
  const [overviewDate, setOverviewDate] = useState(() => kstTodayYmd());
  const [overviewWorkType, setOverviewWorkType] = useState<string>(WT_DEFAULT_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewData, setOverviewData] = useState<ExecutionOverviewData | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState<Record<number, boolean>>({});
  const listScrollRef = useRef<HTMLDivElement>(null);
  const canReorderInCurrentFilter = filterWorkType === WT_ALL;

  const getWorkTypeLabel = (value: string | null | undefined): string => {
    const v = value || WT_ALL;
    const keyMap: Record<string, string> = {
      전체: "all",
      주간: "day",
      오후: "swing",
      야간: "night",
      정오: "noon",
      PC: "pc",
      MO: "mo",
    };
    const k = keyMap[v];
    return k ? t(`admin.workChecklist.workTypes.${k}`) : v;
  };

  const weekdayShort = (n: number) => t(`admin.workChecklist.weekdaysShort.${n}`);

  const formatPeriodDisplay = (item: WorkChecklistItem): string => {
    const from = item.validFrom ? item.validFrom.slice(0, 10) : null;
    const to = item.validTo ? item.validTo.slice(0, 10) : null;
    const months = item.monthsOfYear
      ? String(item.monthsOfYear)
          .split(",")
          .map((n) => parseInt(n.trim(), 10))
          .filter((n) => n >= 1 && n <= 12)
      : [];
    const parts: string[] = [];
    if (from || to) parts.push(from && to ? `${from} ~ ${to}` : from ? `${from}~` : `~${to}`);
    if (months.length === 12) parts.push(t("admin.workChecklist.periodEveryMonth"));
    else if (months.length > 0)
      parts.push(months.map((m) => t("admin.workChecklist.periodMonthSuffix", { n: m })).join(", "));
    return parts.length ? parts.join(" · ") : t("admin.workChecklist.periodDash");
  };

  const formatDaysOfWeekDisplay = (item: WorkChecklistItem): string => {
    if (!item.daysOfWeek || !String(item.daysOfWeek).trim()) {
      return t("admin.workChecklist.allWeekdays");
    }
    const nums = String(item.daysOfWeek)
      .split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => n >= 1 && n <= 7);
    if (nums.length === 7) return t("admin.workChecklist.allWeekdays");
    if (!nums.length) return t("admin.workChecklist.periodDash");
    return nums
      .map((n) => weekdayShort(n))
      .filter(Boolean)
      .join(", ");
  };

  const handleListDragOverForScroll = useCallback((e: React.DragEvent) => {
    if (dragIndex === null || !listScrollRef.current) return;
    const rect = listScrollRef.current.getBoundingClientRect();
    const edge = 60;
    if (e.clientY < rect.top + edge) {
      listScrollRef.current.scrollTop -= 12;
    } else if (e.clientY > rect.bottom - edge) {
      listScrollRef.current.scrollTop += 12;
    }
  }, [dragIndex]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeInactive) params.set("includeInactive", "true");
      if (filterWorkType) params.set("workType", filterWorkType);
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/work-checklist/items${q}`, {
        headers: createAuthHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.data ?? data ?? []);
      }
    } catch (e) {
      console.error("Failed to load checklist items", e);
    } finally {
      setLoading(false);
    }
  };

  const loadBanner = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/work-checklist/banner", { headers: createAuthHeaders(token) });
      if (res.ok) {
        const json = await res.json();
        const data = json.data ?? json;
        setBannerContent(data?.content ?? "");
      }
    } catch (e) {
      console.error("Failed to load banner", e);
    }
  };

  useEffect(() => {
    if (token && (user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN")) {
      loadItems();
      loadBanner();
    }
  }, [token, user, includeInactive, filterWorkType]);

  const openCreate = () => {
    setEditingItem(null);
    setFormTitle("");
    setFormWorkType(WT_ALL);
    setFormValidFrom("");
    setFormValidTo("");
    setFormMonths([]);
    setFormDaysOfWeek([]);
    setFormActive(true);
    setFormShowInPC(false);
    setFormShowInMO(false);
    setFormUrl("");
    setShowForm(true);
  };

  const openEdit = (item: WorkChecklistItem) => {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormWorkType(
      item.workType && WORK_TYPE_VALUES.includes(item.workType as (typeof WORK_TYPE_VALUES)[number])
        ? item.workType!
        : WT_ALL
    );
    setFormValidFrom(item.validFrom || "");
    setFormValidTo(item.validTo || "");
    setFormMonths(
      item.monthsOfYear
        ? String(item.monthsOfYear)
            .split(",")
            .map((n) => parseInt(n.trim(), 10))
            .filter((n) => n >= 1 && n <= 12)
        : []
    );
    setFormDaysOfWeek(
      item.daysOfWeek
        ? String(item.daysOfWeek)
            .split(",")
            .map((n) => parseInt(n.trim(), 10))
            .filter((n) => n >= 1 && n <= 7)
        : []
    );
    setFormActive(!!item.isActive);
    setFormShowInPC(!!(item.showInPC === 1 || item.workType === "PC"));
    setFormShowInMO(!!(item.showInMO === 1 || item.workType === "MO"));
    setFormUrl(item.url || "");
    setShowForm(true);
  };

  const saveItem = async () => {
    if (!formTitle.trim()) {
      alert(t("admin.workChecklist.needItemName"));
      return;
    }
    setSaving(true);
    try {
      const headers = {
        ...createAuthHeaders(token),
        "Content-Type": "application/json",
      };
      if (editingItem) {
        const res = await fetch(`/api/work-checklist/items/${editingItem.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            title: formTitle.trim(),
            workType: formWorkType,
            validFrom: formValidFrom.trim() || null,
            validTo: formValidTo.trim() || null,
            monthsOfYear: formMonths.length > 0 ? formMonths.sort((a, b) => a - b).join(",") : null,
            daysOfWeek: formDaysOfWeek.length > 0 ? formDaysOfWeek.sort((a, b) => a - b).join(",") : null,
            isActive: formActive,
            showInPC: formShowInPC,
            showInMO: formShowInMO,
            url: formUrl.trim() || null,
          }),
        });
        if (res.ok) {
          await loadItems();
          setShowForm(false);
        } else {
          const err = await res.json();
          alert(err.message || t("admin.workChecklist.editFailed"));
        }
      } else {
        const res = await fetch("/api/work-checklist/items", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: formTitle.trim(),
            workType: formWorkType,
            showInPC: formShowInPC,
            showInMO: formShowInMO,
            validFrom: formValidFrom.trim() || null,
            validTo: formValidTo.trim() || null,
            monthsOfYear: formMonths.length > 0 ? formMonths.sort((a, b) => a - b).join(",") : null,
            daysOfWeek: formDaysOfWeek.length > 0 ? formDaysOfWeek.sort((a, b) => a - b).join(",") : null,
            isActive: formActive,
            url: formUrl.trim() || null,
          }),
        });
        if (res.ok) {
          await loadItems();
          setShowForm(false);
        } else {
          const err = await res.json();
          alert(err.message || t("admin.workChecklist.addFailed"));
        }
      }
    } catch (e) {
      console.error(e);
      alert(t("admin.workChecklist.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm(t("admin.workChecklist.deleteConfirm"))) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/work-checklist/items/${id}`, {
        method: "DELETE",
        headers: createAuthHeaders(token),
      });
      if (res.ok) await loadItems();
      else {
        const err = await res.json();
        alert(err.message || t("admin.workChecklist.deleteFailed"));
      }
    } catch (e) {
      console.error(e);
      alert(t("admin.workChecklist.deleteError"));
    } finally {
      setDeletingId(null);
    }
  };

  const saveOrderToApi = async (orderedItems: WorkChecklistItem[], movedTitle?: string, moveDesc?: string) => {
    if (!canReorderInCurrentFilter) {
      setOrderSaveMessage(t("admin.workChecklist.reorderBlocked"));
      setTimeout(() => setOrderSaveMessage(null), 4000);
      return;
    }
    const itemIds = orderedItems.map((i) => i.id);
    try {
      const res = await fetch("/api/work-checklist/items/reorder", {
        method: "POST",
        headers: {
          ...createAuthHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemIds,
        }),
      });
      if (res.ok) {
        await loadItems();
        setOrderSaveMessage(
          t("admin.workChecklist.orderSaved", {
            detail:
              movedTitle && moveDesc
                ? t("admin.workChecklist.orderSavedMoved", { title: movedTitle, desc: moveDesc })
                : "",
          })
        );
        setTimeout(() => setOrderSaveMessage(null), 5000);
      } else {
        const err = await res.json();
        alert(err.message || t("admin.workChecklist.reorderFailed"));
      }
    } catch (e) {
      console.error(e);
      alert(t("admin.workChecklist.reorderFailed"));
    }
  };

  const moveItem = async (index: number, direction: "up" | "down" | "top" | "bottom") => {
    if (!canReorderInCurrentFilter) return;
    const newOrder = [...items];
    let targetIndex: number;
    if (direction === "top") {
      if (index === 0) return;
      targetIndex = 0;
    } else if (direction === "bottom") {
      if (index === newOrder.length - 1) return;
      targetIndex = newOrder.length - 1;
    } else {
      const swap = direction === "up" ? index - 1 : index + 1;
      if (swap < 0 || swap >= newOrder.length) return;
      targetIndex = swap;
    }
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(targetIndex, 0, moved);
    const moveDesc =
      direction === "top"
        ? t("admin.workChecklist.moveTop")
        : direction === "bottom"
          ? t("admin.workChecklist.moveBottom")
          : direction === "up"
            ? t("admin.workChecklist.moveUp")
            : t("admin.workChecklist.moveDown");
    await saveOrderToApi(newOrder, moved.title, moveDesc);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!canReorderInCurrentFilter) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.setDragImage(e.currentTarget as HTMLElement, 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!canReorderInCurrentFilter) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, toIndex: number) => {
    if (!canReorderInCurrentFilter) return;
    e.preventDefault();
    setDragOverIndex(null);
    setDragIndex(null);
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (fromIndex === toIndex || Number.isNaN(fromIndex)) return;
    const newOrder = [...items];
    const [moved] = newOrder.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    newOrder.splice(insertAt, 0, moved);
    await saveOrderToApi(newOrder, moved.title, t("admin.workChecklist.moveDrag"));
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  if (!token || (user?.role !== "ADMIN" && user?.role !== "LEAD" && user?.role !== "SUPERADMIN")) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
        {t("admin.workChecklist.needAdmin")}
      </div>
    );
  }

  const openLink = (url: string) => {
    const u = url.trim();
    if (!u) return;
    const href = u.startsWith("http://") || u.startsWith("https://") ? u : `https://${u}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const loadExecutionOverview = async () => {
    if (!token) return;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const params = new URLSearchParams({ date: overviewDate, workType: overviewWorkType });
      const res = await fetch(`/api/work-checklist/executions/overview?${params.toString()}`, {
        headers: createAuthHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOverviewData(null);
        setOverviewError(
          json.message || json.error || t("admin.workChecklist.overviewLoadFailed", { status: res.status })
        );
        return;
      }
      const data = (json.data ?? json) as ExecutionOverviewData;
      setOverviewData(data);
    } catch (e) {
      console.error(e);
      setOverviewData(null);
      setOverviewError(t("admin.workChecklist.overviewLoadError"));
    } finally {
      setOverviewLoading(false);
    }
  };

  const saveBanner = async () => {
    if (!token) return;
    setBannerSaving(true);
    setBannerSaveMessage(null);
    try {
      const res = await fetch("/api/work-checklist/banner", {
        method: "PATCH",
        headers: { ...createAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ content: bannerContent }),
      });
      if (res.ok) {
        setBannerSaveMessage(t("admin.workChecklist.bannerSaved"));
        setTimeout(() => setBannerSaveMessage(null), 4000);
      } else {
        const err = await res.json();
        alert(err.message || t("admin.workChecklist.bannerSaveFailed"));
      }
    } catch (e) {
      console.error(e);
      alert(t("admin.workChecklist.saveError"));
    } finally {
      setBannerSaving(false);
    }
  };

  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-6 px-2 sm:px-3">
      <div className="min-w-0">
        <h1 className="break-words text-xl font-bold tracking-tight text-slate-800 sm:text-2xl">
          {t("admin.workChecklist.title")}
        </h1>
        <p className="mt-1.5 break-words text-sm leading-relaxed text-slate-600">{t("admin.workChecklist.subtitle")}</p>
      </div>

      {/* 체크리스트 상단 알림글 (에이전트 화면 상단 고정 노출) */}
      <div className="ui-card ui-card-pad">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t("admin.workChecklist.bannerHeading")}</h2>
        <p className="mb-3 text-xs text-slate-500">{t("admin.workChecklist.bannerHint")}</p>
        <textarea
          value={bannerContent}
          onChange={(e) => setBannerContent(e.target.value)}
          placeholder={t("admin.workChecklist.bannerPlaceholder")}
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            type="button"
            onClick={saveBanner}
            disabled={bannerSaving}
            variant="outline"
            className="bg-slate-700 text-white border-slate-700 hover:bg-slate-600"
          >
            {bannerSaving ? t("admin.workChecklist.bannerSaving") : t("admin.workChecklist.bannerSave")}
          </Button>
          {bannerSaveMessage && (
            <span className="text-sm text-green-600">{bannerSaveMessage}</span>
          )}
        </div>
      </div>

      {/* 에이전트 체크 현황 (시프트·날짜별 집계) */}
      <div className="ui-card ui-card-pad">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">{t("admin.workChecklist.overviewHeading")}</h2>
        <p className="mb-3 text-xs text-slate-500">{t("admin.workChecklist.overviewIntro")}</p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="overview-date" className="mb-1 block text-xs font-medium text-slate-600">
              {t("admin.workChecklist.overviewDateLabel")}
            </label>
            <LocalizedDateInput
              id="overview-date"
              type="date"
              value={overviewDate}
              onChange={(e) => setOverviewDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="overview-work-type" className="mb-1 block text-xs font-medium text-slate-600">
              {t("admin.workChecklist.overviewWorkType")}
            </label>
            <select
              id="overview-work-type"
              value={overviewWorkType}
              onChange={(e) => setOverviewWorkType(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {WORK_TYPE_VALUES.map((w) => (
                <option key={w} value={w}>
                  {getWorkTypeLabel(w)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={loadExecutionOverview}
            disabled={overviewLoading}
            variant="outline"
            className="bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
          >
            {overviewLoading ? t("admin.workChecklist.overviewLoading") : t("admin.workChecklist.overviewLoad")}
          </Button>
        </div>
        {overviewError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{overviewError}</div>
        )}
        {overviewData && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              {t("admin.workChecklist.overviewStats", {
                items: overviewData.totalItems,
                users: overviewData.users.length,
              })}
              {overviewData.totalItems === 0 && (
                <span className="ml-2 text-amber-700">{t("admin.workChecklist.overviewNoItems")}</span>
              )}
              {overviewData.totalItems > 0 && overviewData.users.length === 0 && (
                <span className="ml-2 text-amber-700">{t("admin.workChecklist.overviewNoUsers")}</span>
              )}
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      {t("admin.workChecklist.tableName")}
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      {t("admin.workChecklist.tableEmail")}
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-700">
                      {t("admin.workChecklist.tableChecks")}
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-700">
                      {t("admin.workChecklist.tableDone")}
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-700">
                      {t("admin.workChecklist.tableDetail")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overviewData.users.map((u) => (
                    <Fragment key={u.userId}>
                      <tr className="bg-white hover:bg-slate-50/80">
                        <td className="px-3 py-2 text-slate-800">{u.name || t("admin.workChecklist.dash")}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-slate-600" title={u.email || ""}>
                          {u.email || t("admin.workChecklist.dash")}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-slate-800">
                          {u.checkedCount} / {u.totalItems}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {u.totalItems === 0 ? (
                            <span className="text-slate-400">{t("admin.workChecklist.dash")}</span>
                          ) : u.allChecked ? (
                            <span className="font-medium text-emerald-700">{t("admin.workChecklist.yes")}</span>
                          ) : (
                            <span className="font-medium text-amber-800">{t("admin.workChecklist.no")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            type="button"
                            disabled={u.totalItems === 0}
                            onClick={() =>
                              setOverviewExpanded((prev) => ({ ...prev, [u.userId]: !prev[u.userId] }))
                            }
                            variant="ghost"
                            size="sm"
                          >
                            {overviewExpanded[u.userId]
                              ? t("admin.workChecklist.collapse")
                              : t("admin.workChecklist.expand")}
                          </Button>
                        </td>
                      </tr>
                      {overviewExpanded[u.userId] && u.totalItems > 0 && (
                        <tr className="bg-slate-50/90">
                          <td colSpan={5} className="px-3 py-2">
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
                                  {it.checkedAt && (
                                    <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">
                                      {it.checkedAt.slice(0, 19).replace("T", " ")}
                                    </span>
                                  )}
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
          </div>
        )}
      </div>

      <div className="ui-card ui-card-pad flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
          />
          <span className="text-sm font-medium text-slate-700">{t("admin.workChecklist.includeInactive")}</span>
        </label>
        <div className="flex items-center gap-2">
          <label htmlFor="filter-work-type" className="text-sm font-medium text-slate-700">
            {t("admin.workChecklist.workTypeFilter")}
          </label>
          <select
            id="filter-work-type"
            value={filterWorkType}
            onChange={(e) => { setFilterWorkType(e.target.value); setOrderSaveMessage(null); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {WORK_TYPE_VALUES.map((w) => (
              <option key={w} value={w}>
                {getWorkTypeLabel(w)}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">{t("admin.workChecklist.reorderHint")}</span>
        </div>
        <Button type="button" onClick={openCreate} variant="primary">
          {t("admin.workChecklist.addItem")}
        </Button>
      </div>

      {orderSaveMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800" role="status">
          <span className="shrink-0">✓</span>
          <span>{orderSaveMessage}</span>
        </div>
      )}

      <div className="ui-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">{t("admin.workChecklist.loading")}</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">{t("admin.workChecklist.emptyList")}</div>
        ) : (
          <div
            ref={listScrollRef}
            className="overflow-x-auto overflow-y-auto max-h-[60vh]"
            onDragOver={handleListDragOverForScroll}
          >
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: "13%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    <span className="inline-flex items-center gap-0.5">
                      {t("admin.workChecklist.colOrder")}
                      <span
                        className="font-normal normal-case text-slate-500"
                        title={t("admin.workChecklist.colOrderDragTitle")}
                      >
                        {t("admin.workChecklist.colOrderDrag")}
                      </span>
                    </span>
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colItem")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colWorkType")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colWeekdays")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colPeriod")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colStatus")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colLink")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t("admin.workChecklist.colActions")}
                  </th>
                </tr>
              </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {items.map((item, index) => (
                <tr
                  key={item.id}
                  className={`hover:bg-slate-50/80 transition-colors ${dragIndex === index ? "opacity-50" : ""} ${dragOverIndex === index ? "ring-1 ring-inset ring-blue-400 bg-blue-50/50" : ""}`}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <td className="px-2 py-2 align-middle">
                    <div className="flex items-center gap-0.5 flex-wrap">
                      <span
                        draggable={canReorderInCurrentFilter}
                        onDragStart={(e) => handleDragStart(e, index)}
                        className={`rounded p-0.5 text-slate-400 select-none touch-none ${
                          canReorderInCurrentFilter
                            ? "cursor-grab active:cursor-grabbing hover:text-slate-600 hover:bg-slate-200"
                            : "cursor-not-allowed opacity-40"
                        }`}
                        title={
                          canReorderInCurrentFilter
                            ? t("admin.workChecklist.colOrderDragTitle")
                            : t("admin.workChecklist.colOrderDragDisabled")
                        }
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") e.preventDefault();
                        }}
                      >
                        ⋮⋮
                      </span>
                      <Button
                        type="button"
                        onClick={() => moveItem(index, "top")}
                        disabled={!canReorderInCurrentFilter || index === 0}
                        variant="ghost"
                        size="sm"
                        className="px-2 text-slate-500 hover:text-slate-700"
                        title={t("admin.workChecklist.titleTop")}
                      >
                        ⏫
                      </Button>
                      <Button
                        type="button"
                        onClick={() => moveItem(index, "up")}
                        disabled={!canReorderInCurrentFilter || index === 0}
                        variant="ghost"
                        size="sm"
                        className="px-2 text-slate-500 hover:text-slate-700"
                        title={t("admin.workChecklist.titleUp")}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        onClick={() => moveItem(index, "down")}
                        disabled={!canReorderInCurrentFilter || index === items.length - 1}
                        variant="ghost"
                        size="sm"
                        className="px-2 text-slate-500 hover:text-slate-700"
                        title={t("admin.workChecklist.titleDown")}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        onClick={() => moveItem(index, "bottom")}
                        disabled={!canReorderInCurrentFilter || index === items.length - 1}
                        variant="ghost"
                        size="sm"
                        className="px-2 text-slate-500 hover:text-slate-700"
                        title={t("admin.workChecklist.titleBottom")}
                      >
                        ⏬
                      </Button>
                      <span className="text-xs tabular-nums text-slate-500">{index + 1}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 align-middle min-w-0">
                    <span className="block truncate text-xs font-medium text-slate-800" title={item.title}>{item.title}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 align-middle">
                    <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                      {getWorkTypeLabel(item.workType)}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-middle text-[11px] text-slate-600 truncate" title={formatDaysOfWeekDisplay(item)}>
                    {formatDaysOfWeekDisplay(item)}
                  </td>
                  <td className="px-2 py-2 align-middle text-[11px] text-slate-600 truncate" title={formatPeriodDisplay(item)}>
                    {formatPeriodDisplay(item)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 align-middle">
                    <span
                      className={
                        item.isActive
                          ? "inline-block rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800"
                          : "inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                      }
                    >
                      {item.isActive ? t("admin.workChecklist.statusActive") : t("admin.workChecklist.statusInactive")}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-center align-middle">
                    {item.url ? (
                      <Button type="button" onClick={() => openLink(item.url!)} variant="outline" size="sm" title={item.url}>
                        {t("admin.workChecklist.linkButton")}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-slate-400">{t("admin.workChecklist.dash")}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-middle">
                    <span className="inline-flex items-center justify-end gap-1">
                      <Button type="button" onClick={() => openEdit(item)} variant="ghost" size="sm">
                        {t("admin.workChecklist.edit")}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => deleteItem(item.id)}
                        disabled={deletingId === item.id}
                        variant="danger"
                        size="sm"
                      >
                        {deletingId === item.id ? t("admin.workChecklist.deleting") : t("admin.workChecklist.delete")}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-xl font-bold tracking-tight text-slate-800">
              {editingItem ? t("admin.workChecklist.formEdit") : t("admin.workChecklist.formAdd")}
            </h2>
            <p className="mb-5 text-sm text-slate-500">
              {editingItem ? t("admin.workChecklist.formEditHint") : t("admin.workChecklist.formAddHint")}
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("admin.workChecklist.fieldItemName")}
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={t("admin.workChecklist.itemNamePlaceholder")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("admin.workChecklist.fieldUrl")}</label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={t("admin.workChecklist.urlPlaceholder")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">{t("admin.workChecklist.urlHint")}</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("admin.workChecklist.workTypeFilter")}
                </label>
                <select
                  value={formWorkType}
                  onChange={(e) => setFormWorkType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {WORK_TYPE_VALUES.map((w) => (
                    <option key={w} value={w}>
                      {getWorkTypeLabel(w)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">{t("admin.workChecklist.workTypeHint")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">{t("admin.workChecklist.validFrom")}</label>
                  <LocalizedDateInput
                    type="date"
                    value={formValidFrom}
                    onChange={(e) => setFormValidFrom(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">{t("admin.workChecklist.validTo")}</label>
                  <LocalizedDateInput
                    type="date"
                    value={formValidTo}
                    onChange={(e) => setFormValidTo(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">{t("admin.workChecklist.periodHint")}</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("admin.workChecklist.monthsLabel")}</label>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 12 }, (_, idx) => {
                    const month = idx + 1;
                    const checked = formMonths.includes(month);
                    return (
                      <label
                        key={month}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setFormMonths((prev) => [...prev, month].sort((a, b) => a - b));
                            else setFormMonths((prev) => prev.filter((m) => m !== month));
                          }}
                          className="rounded border-slate-300"
                        />
                        {t(`admin.workChecklist.months.${month}`)}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-500">{t("admin.workChecklist.monthsHint")}</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("admin.workChecklist.weekdaysLabel")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_VALUES.map((value) => {
                    const checked = formDaysOfWeek.includes(value);
                    return (
                      <label
                        key={value}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormDaysOfWeek((prev) => [...prev, value].sort((a, b) => a - b));
                            } else {
                              setFormDaysOfWeek((prev) => prev.filter((d) => d !== value));
                            }
                          }}
                          className="rounded border-slate-300"
                        />
                        {weekdayShort(value)}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-500">{t("admin.workChecklist.weekdaysHint")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700">{t("admin.workChecklist.activeLabel")}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formShowInPC}
                    onChange={(e) => setFormShowInPC(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700">{t("admin.workChecklist.showPc")}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formShowInMO}
                    onChange={(e) => setFormShowInMO(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700">{t("admin.workChecklist.showMo")}</span>
                </label>
              </div>
              <p className="mt-1 text-xs text-slate-500">{t("admin.workChecklist.floatingHint")}</p>
            </div>
            <div className="mt-6 flex gap-3">
              <Button type="button" onClick={saveItem} disabled={saving} variant="primary" className="flex-1">
                {saving ? t("admin.workChecklist.saving") : t("admin.workChecklist.save")}
              </Button>
              <Button type="button" onClick={() => setShowForm(false)} variant="outline" className="flex-1">
                {t("admin.workChecklist.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
