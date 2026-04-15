import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { fmt, kstCalendarDateString, formatClanIssueListDate } from "../../utils/formatters";
import { Button } from "../../components/ui/Button";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

interface ClanIssue {
  id: string;
  summary: string;
  detail: string;
  date: string;
  sourceCreatedAt?: string; // 원본 게시글 작성 시간
  sourceUrl?: string;
  monitoredBoard?: {
    id: number;
    name: string;
    cafeGame: string;
  };
  alerts: Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    duplicateCount?: number;
    date?: string;
    relatedIssueIds?: string[];
    relatedIssues?: Array<{ id: string; summary: string; sourceUrl: string | null; date?: string | null; createdAt?: string | null; sourceCreatedAt?: string | null }>;  // 링크 확인용
  }>;
  createdAt: string;
  dismissedAlerts?: string[]; // 해제된 알림 타입 목록
}

interface ClanIssuesResponse {
  issues: ClanIssue[];
  total: number;
  limit: number | null;
  offset: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

const SEVERITY_BADGE_COLORS: Record<string, string> = {
  low: 'bg-blue-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500'
};

export default function ClanManagement() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token } = useAuth();
  const [issues, setIssues] = useState<ClanIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  /** 접속 시 기본: KST 당일 1일치만 조회 (초기화 버튼으로 전체 기간) */
  const [startDate, setStartDate] = useState<string>(() => kstCalendarDateString());
  const [endDate, setEndDate] = useState<string>(() => kstCalendarDateString());
  const [currentPage, setCurrentPage] = useState(1);
  const [filterAlertsOnly, setFilterAlertsOnly] = useState(false);
  const [filterAlertType, setFilterAlertType] = useState<string | null>(null); // 알림 종류별 필터
  const [dismissedAlerts, setDismissedAlerts] = useState<Record<string, string[]>>({});
  const [totalAlertCount, setTotalAlertCount] = useState<number>(0); // 전체 알림 개수 (메뉴와 동일)
  const alertTypeKeys = useMemo(
    () => ["excessive_emojis", "special_char_emoticons", "gender_expression", "duplicate_promotion"],
    []
  );
  const alertTypeLabel = useMemo(
    () => ({
      excessive_emojis: t("admin.clan.alertTypes.excessive_emojis"),
      special_char_emoticons: t("admin.clan.alertTypes.special_char_emoticons"),
      gender_expression: t("admin.clan.alertTypes.gender_expression"),
      duplicate_promotion: t("admin.clan.alertTypes.duplicate_promotion"),
    }),
    [t]
  );
  const [fullAlertCounts, setFullAlertCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(alertTypeKeys.map((k) => [k, 0]))
  ); // 알림 종류별 개수 (전체 데이터 기준, 페이지와 무관)
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set()); // 선택된 이슈 ID 목록
  const [expandedRelatedIssueId, setExpandedRelatedIssueId] = useState<string | null>(null);
  const [relatedIssuesCache, setRelatedIssuesCache] = useState<Record<string, ClanIssue[]>>({});
  const itemsPerPage = 100; // 한 화면에 더 많이 표시

  const authHeaders = useMemo(() => createAuthHeaders(token) ?? {}, [token]);

  // localStorage에서 해제된 알림 로드
  useEffect(() => {
    const saved = localStorage.getItem('clanDismissedAlerts');
    if (saved) {
      try {
        setDismissedAlerts(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load dismissed alerts:', e);
      }
    }
  }, []);

  // 해제된 알림 저장
  const saveDismissedAlerts = (newDismissed: Record<string, string[]>) => {
    setDismissedAlerts(newDismissed);
    localStorage.setItem('clanDismissedAlerts', JSON.stringify(newDismissed));
    // 같은 탭에서 localStorage 변경을 다른 컴포넌트에 알리기 위한 CustomEvent 발생
    window.dispatchEvent(new CustomEvent('clanDismissedAlertsChanged'));
  };

  useEffect(() => {
    loadIssues();
  }, [startDate, endDate, currentPage, filterAlertsOnly, filterAlertType]);

  async function loadIssues() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) {
        params.append('startDate', startDate);
      }
      if (endDate) {
        params.append('endDate', endDate);
      }
      // 알림 필터 또는 알림 종류별 필터가 활성화되면 더 많은 데이터를 가져와서 필터링
      if (filterAlertsOnly || filterAlertType) {
        params.append('limit', '1000');
        params.append('offset', '0');
      } else {
        params.append('limit', itemsPerPage.toString());
        params.append('offset', ((currentPage - 1) * itemsPerPage).toString());
      }

      const url = `/api/issues/clan?${params.toString()}`;
      const res = await fetch(url, { headers: authHeaders });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const body = await res.json();
      const data: ClanIssuesResponse = body.data || body;
      
      setIssues(data.issues || []);
      setTotal(data.total || 0);
      
      // 전체 알림 개수를 정확히 계산하기 위해 별도로 전체 데이터 조회 (알림 개수만)
      // 하지만 성능을 위해 현재 페이지의 데이터로만 계산하도록 유지
      // 대신 메뉴의 알림 개수와 동일한 로직 사용
    } catch (err: any) {
      setError(err.message || t("admin.clan.errors.loadFailed"));
      console.error('Failed to load clan issues:', err);
    } finally {
      setLoading(false);
    }
  }
  
  // 전체 알림 개수 계산 (메뉴와 동일한 로직)
  useEffect(() => {
    const fetchTotalAlertCount = async () => {
      try {
        const params = new URLSearchParams();
        if (startDate) {
          params.append('startDate', startDate);
        }
        if (endDate) {
          params.append('endDate', endDate);
        }
        // 전체 알림 개수를 정확히 계산하기 위해 limit을 크게 설정
        params.append('limit', '10000');
        
        const url = `/api/issues/clan?${params.toString()}`;
        const res = await fetch(url, { headers: authHeaders });
        
        if (res.ok) {
          const body = await res.json();
          const data: ClanIssuesResponse = body.data || body;
          const allIssues = data.issues || [];
          
          // 해제되지 않은 알림이 있는 게시글 개수 (메뉴와 동일한 로직)
          const count = allIssues.filter((issue: ClanIssue) => {
            if (!issue.alerts || issue.alerts.length === 0) return false;
            const dismissed = dismissedAlerts[issue.id] || [];
            const activeAlerts = issue.alerts.filter((alert) => !dismissed.includes(alert.type));
            return activeAlerts.length > 0;
          }).length;
          setTotalAlertCount(count);

          // 알림 종류별 개수 (같은 전체 데이터 기준 - 페이지와 무관하게 일관된 수치)
          const counts: Record<string, number> = {};
          alertTypeKeys.forEach((type) => {
            counts[type] = 0;
          });
          allIssues.forEach((issue: ClanIssue) => {
            const dismissed = dismissedAlerts[issue.id] || [];
            const activeAlerts = (issue.alerts || []).filter((a) => !dismissed.includes(a.type));
            activeAlerts.forEach((alert) => {
              counts[alert.type] = (counts[alert.type] ?? 0) + 1;
            });
          });
          setFullAlertCounts(counts);
        }
      } catch (err) {
        console.error('Failed to fetch total alert count:', err);
      }
    };
    
    // 날짜 필터나 프로젝트가 변경될 때만 전체 알림 개수 재계산
    fetchTotalAlertCount();
     
  }, [startDate, endDate, dismissedAlerts, token]);

  const handleDateFilter = () => {
    setCurrentPage(1);
    loadIssues();
  };

  const handleResetDates = () => {
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  // 해제되지 않은 알림만 필터링
  const getActiveAlerts = (issue: ClanIssue) => {
    if (!issue.alerts || issue.alerts.length === 0) return [];
    const dismissed = dismissedAlerts[issue.id] || [];
    return issue.alerts.filter(alert => !dismissed.includes(alert.type));
  };

  // 알림 해제
  const handleDismissAlert = (issueId: string, alertType: string) => {
    const newDismissed = { ...dismissedAlerts };
    if (!newDismissed[issueId]) {
      newDismissed[issueId] = [];
    }
    if (!newDismissed[issueId].includes(alertType)) {
      newDismissed[issueId].push(alertType);
      saveDismissedAlerts(newDismissed);
    }
  };

  // 모든 알림 해제
  const handleDismissAllAlerts = (issueId: string, alertTypes: string[]) => {
    const newDismissed = { ...dismissedAlerts };
    newDismissed[issueId] = [...alertTypes];
    saveDismissedAlerts(newDismissed);
  };

  // 선택된 모든 이슈의 알림 일괄 해제
  const handleDismissSelectedAlerts = () => {
    if (selectedIssueIds.size === 0) return;
    
    const newDismissed = { ...dismissedAlerts };
    let hasChanges = false;
    
    // 선택된 모든 이슈에 대해
    selectedIssueIds.forEach(issueId => {
      const issue = issues.find(i => i.id === issueId);
      if (issue) {
        const activeAlerts = getActiveAlerts(issue);
        if (activeAlerts.length > 0) {
          // 해당 이슈의 모든 알림 타입을 해제 목록에 추가
          const alertTypes = activeAlerts.map(a => a.type);
          newDismissed[issueId] = [...(newDismissed[issueId] || []), ...alertTypes];
          // 중복 제거
          newDismissed[issueId] = [...new Set(newDismissed[issueId])];
          hasChanges = true;
        }
      }
    });
    
    if (hasChanges) {
      saveDismissedAlerts(newDismissed);
      // 선택 해제 (선택 사항)
      // setSelectedIssueIds(new Set());
    }
  };

  // 선택된 이슈 중 알림이 있는 이슈 개수 계산
  const selectedIssuesWithAlerts = useMemo(() => {
    return Array.from(selectedIssueIds).filter(issueId => {
      const issue = issues.find(i => i.id === issueId);
      if (!issue) return false;
      const activeAlerts = getActiveAlerts(issue);
      return activeAlerts.length > 0;
    }).length;
  }, [selectedIssueIds, issues, dismissedAlerts]);

  // 필터링된 이슈 목록
  const filteredIssues = useMemo(() => {
    let filtered = issues;
    
    if (filterAlertsOnly || filterAlertType) {
      filtered = issues.filter(issue => {
        const activeAlerts = getActiveAlerts(issue);
        if (activeAlerts.length === 0) return false;
        // 알림 종류별 필터: 해당 타입이 있으면 포함
        if (filterAlertType) {
          return activeAlerts.some(a => a.type === filterAlertType);
        }
        return true;
      });
    }
    
    return filtered;
  }, [issues, filterAlertsOnly, filterAlertType, dismissedAlerts]);

  // 알림 필터 활성화 시 클라이언트 페이지네이션 사용
  const totalPages = (filterAlertsOnly || filterAlertType)
    ? Math.ceil(filteredIssues.length / itemsPerPage)
    : Math.ceil(total / itemsPerPage);
  
  // 알림 필터 활성화 시 클라이언트에서 페이지네이션된 데이터
  const paginatedIssues = (filterAlertsOnly || filterAlertType)
    ? filteredIssues.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
    : filteredIssues;

  // 알림 요약은 전체 데이터 기준 fullAlertCounts 사용 (페이지 이동 시 수치 일관성)
  const alertCounts = fullAlertCounts;

  // 전체 선택/해제
  const handleSelectAll = () => {
    if (selectedIssueIds.size === paginatedIssues.length) {
      // 모두 선택되어 있으면 모두 해제
      setSelectedIssueIds(new Set());
    } else {
      // 모두 선택
      setSelectedIssueIds(new Set(paginatedIssues.map(issue => issue.id)));
    }
  };

  // 개별 선택/해제
  const handleToggleIssue = (issueId: string) => {
    setSelectedIssueIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(issueId)) {
        newSet.delete(issueId);
      } else {
        newSet.add(issueId);
      }
      return newSet;
    });
  };

  // 현재 페이지의 모든 이슈가 선택되어 있는지 확인
  const isAllSelected = paginatedIssues.length > 0 && paginatedIssues.every(issue => selectedIssueIds.has(issue.id));

  return (
    <div className="ui-page">
      <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">{t("admin.clan.title")}</h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed max-w-5xl">
          {t("admin.clan.description.p1")}{" "}
          <strong className="font-medium text-slate-700 dark:text-slate-300">{t("admin.clan.description.todayOneDay")}</strong>
          {t("admin.clan.description.p2")}{" "}
          <strong className="font-medium text-slate-700 dark:text-slate-300">{t("admin.clan.description.sourceCreatedAt")}</strong>
          {t("admin.clan.description.p3")}{" "}
          <strong className="font-medium text-slate-700 dark:text-slate-300">{t("admin.clan.description.dateFilterRuleStrong")}</strong>
          {t("admin.clan.description.p4")}{" "}
          <strong className="font-medium text-slate-700 dark:text-slate-300">{t("admin.clan.description.menu178Strong")}</strong>
          {t("admin.clan.description.p5")}
        </p>
      </div>

      {/* 필터·날짜·적용 — 카드 안에서 정렬 통일 */}
      <div className="ui-card ui-card-pad mb-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:flex-wrap xl:items-end xl:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <Button
              onClick={() => {
                setFilterAlertsOnly(!filterAlertsOnly);
                setFilterAlertType(null); // 전체 알림 필터 시 종류별 필터 해제
                setCurrentPage(1);
              }}
              variant={filterAlertsOnly ? "danger" : "outline"}
              size="lg"
              className="shadow-sm w-full sm:w-auto justify-center"
            >
              {filterAlertsOnly ? (
                <>
                  <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-left">{t("admin.clan.filters.alertsOnly")}</span>
                  {totalAlertCount > 0 && (
                    <span className="ml-1 px-2 py-0.5 bg-white/20 text-white rounded-full text-xs font-bold tabular-nums">
                      {totalAlertCount}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <span className="text-left">{t("admin.clan.filters.alertsOnly")}</span>
                  {totalAlertCount > 0 && (
                    <span className="ml-1 px-2 py-0.5 bg-red-500 text-white rounded-full text-xs font-bold tabular-nums">
                      {totalAlertCount}
                    </span>
                  )}
                </>
              )}
            </Button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
              <label htmlFor="clan-filter-start" className="ui-label">
                {t("admin.clan.filters.startDate")}
              </label>
              <LocalizedDateInput
                id="clan-filter-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="ui-input dark:bg-slate-800 dark:border-slate-600"
              />
            </div>
            <div className="ui-field min-w-0 sm:min-w-[10.5rem]">
              <label htmlFor="clan-filter-end" className="ui-label">
                {t("admin.clan.filters.endDate")}
              </label>
              <LocalizedDateInput
                id="clan-filter-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="ui-input dark:bg-slate-800 dark:border-slate-600"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-0.5 sm:pb-0">
              <Button onClick={handleDateFilter} variant="primary" className="min-w-[6.5rem] justify-center">
                {t("admin.clan.filters.apply")}
              </Button>
              <Button onClick={handleResetDates} variant="outline" className="min-w-[6rem] justify-center dark:bg-slate-800 dark:border-slate-600">
                {t("admin.clan.filters.reset")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 알림 요약 - 클릭 시 해당 알림 종류로 필터 */}
      <div className="ui-card ui-card-pad mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">{t("admin.clan.alertSummary")}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {alertTypeKeys.map((type) => {
            const count = alertCounts[type] ?? 0;
            const isActive = filterAlertType === type;
            return (
              <Button
                key={type}
                type="button"
                onClick={() => {
                  setFilterAlertType(isActive ? null : type);
                  setCurrentPage(1);
                }}
                variant={isActive ? "danger" : "outline"}
                className="h-auto w-full justify-start items-start px-3 py-3 rounded-xl text-left"
              >
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {alertTypeLabel[type as keyof typeof alertTypeLabel] || type}
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {count}
                </div>
              </Button>
            );
          })}
        </div>
        {filterAlertType && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {t("admin.clan.filters.activeType", {
                type: (filterAlertType && (alertTypeLabel[filterAlertType as keyof typeof alertTypeLabel] || filterAlertType)) || "",
              })}
            </span>
            <Button
              type="button"
              onClick={() => {
                setFilterAlertType(null);
                setCurrentPage(1);
              }}
              variant="ghost"
              size="sm"
              className="text-red-600 dark:text-red-400"
            >
              {t("admin.clan.filters.clear")}
            </Button>
          </div>
        )}
      </div>

      {/* 통계 */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ui-card p-5">
          <div className="text-sm text-slate-600 dark:text-slate-400">{t("admin.clan.stats.totalPosts")}</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{total}</div>
        </div>
        <div className="ui-card p-5">
          <div className="text-sm text-slate-600 dark:text-slate-400">{t("admin.clan.stats.alertPosts")}</div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums">{totalAlertCount}</div>
        </div>
        <div className="ui-card p-5">
          <div className="text-sm text-slate-600 dark:text-slate-400">{t("admin.clan.stats.normalPosts")}</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
            {total - totalAlertCount}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-slate-600 dark:text-slate-400">{t("common.loading", { ns: "translation" })}</p>
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="ui-card ui-card-pad text-center py-12">
          <p className="text-slate-600 dark:text-slate-400">
            {filterAlertType
              ? t("admin.clan.empty.byType", {
                  type: (filterAlertType && (alertTypeLabel[filterAlertType as keyof typeof alertTypeLabel] || filterAlertType)) || "",
                })
              : filterAlertsOnly
                ? t("admin.clan.empty.alertsOnly")
                : t("admin.clan.empty.all")}
          </p>
        </div>
      ) : (
        <>
          {/* 선택된 이슈 정보 및 전체 선택 버튼 */}
          <div className="ui-card ui-card-pad mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600 dark:text-slate-400 min-h-[1.25rem]">
              {selectedIssueIds.size > 0 ? (
                <span>
                  {t("admin.clan.selection.selectedCount", { n: selectedIssueIds.size })}
                  {selectedIssuesWithAlerts > 0 && (
                    <span className="ml-2 text-red-600 dark:text-red-400">
                      {t("admin.clan.selection.withAlerts", { n: selectedIssuesWithAlerts })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">{t("admin.clan.selection.hint")}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedIssueIds.size > 0 && selectedIssuesWithAlerts > 0 && (
                <Button
                  onClick={handleDismissSelectedAlerts}
                  variant="danger"
                  size="sm"
                  className="justify-center"
                  title={t("admin.clan.selection.dismissSelectedTitle")}
                >
                  {t("admin.clan.selection.dismissSelected", { n: selectedIssuesWithAlerts })}
                </Button>
              )}
              <Button
                onClick={handleSelectAll}
                variant={isAllSelected ? "primary" : "outline"}
                size="sm"
                className="min-w-[5.5rem] justify-center dark:bg-slate-800 dark:border-slate-600"
              >
                {isAllSelected ? t("admin.clan.selection.deselectAll") : t("admin.clan.selection.selectAll")}
              </Button>
            </div>
          </div>

          {/* 테이블 형태로 표시 */}
          <div className="ui-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="ui-th w-12">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                        title={isAllSelected ? t("admin.clan.selection.deselectAll") : t("admin.clan.selection.selectAll")}
                      />
                    </th>
                    <th className="ui-th w-12">{t("admin.clan.table.alert")}</th>
                    <th className="ui-th w-24">{t("admin.clan.table.date")}</th>
                    <th className="ui-th">{t("admin.clan.table.title")}</th>
                    <th className="ui-th w-32">{t("admin.clan.table.board")}</th>
                    <th className="ui-th w-32">{t("admin.clan.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {paginatedIssues.map((issue) => {
                    const activeAlerts = getActiveAlerts(issue);
                    const hasAlerts = activeAlerts.length > 0;
                    const isSelected = selectedIssueIds.has(issue.id);
                    
                    return (
                      <tr
                        key={issue.id}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 ${
                          hasAlerts ? 'bg-red-50/50 dark:bg-red-900/10' : ''
                        } ${isSelected ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                      >
                        {/* 선택 체크박스 */}
                        <td className="ui-td">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleIssue(issue.id)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                            title={t("admin.clan.table.selectIssue")}
                          />
                        </td>
                        {/* 알림 컬럼 */}
                        <td className="ui-td">
                          {hasAlerts ? (
                            <div className="flex flex-col gap-2">
                              {activeAlerts.map((alert, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 group"
                                >
                                  <span
                                    className={`inline-block w-3 h-3 rounded-full ${SEVERITY_BADGE_COLORS[alert.severity] || SEVERITY_BADGE_COLORS.medium}`}
                                    title={`${(alertTypeLabel[alert.type as keyof typeof alertTypeLabel] || alert.type)}: ${alert.message}`}
                                  />
                                  <Button
                                    type="button"
                                    onClick={() => handleDismissAlert(issue.id, alert.type)}
                                    variant="outline"
                                    size="sm"
                                    className="px-2 py-1 h-auto min-h-0 text-xs dark:bg-slate-700 dark:border-slate-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                                    title={t("admin.clan.table.dismissOneTitle")}
                                  >
                                    {t("admin.clan.table.dismissOne")}
                                  </Button>
                                </div>
                              ))}
                              {activeAlerts.length > 1 && (
                                <Button
                                  type="button"
                                  onClick={() => handleDismissAllAlerts(issue.id, activeAlerts.map(a => a.type))}
                                  variant="outline"
                                  size="sm"
                                  className="mt-1 h-auto min-h-0 px-2 py-1 text-xs border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40 font-medium"
                                  title={t("admin.clan.table.dismissAllTitle")}
                                >
                                  {t("admin.clan.table.dismissAll")}
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">-</span>
                          )}
                        </td>
                        
                        {/* 날짜 */}
                        <td className="ui-td whitespace-nowrap text-slate-600 dark:text-slate-400">
                          <span
                            title={
                              [
                                issue.date?.trim()
                                  ? t("admin.clan.dateTooltip.dbDate", { date: issue.date })
                                  : null,
                                issue.sourceCreatedAt
                                  ? t("admin.clan.dateTooltip.sourceCreatedAt", {
                                      time: fmt.time(new Date(issue.sourceCreatedAt).getTime()),
                                    })
                                  : null,
                                issue.createdAt
                                  ? t("admin.clan.dateTooltip.createdAt", {
                                      time: fmt.time(new Date(issue.createdAt).getTime()),
                                    })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join("\n") || undefined
                            }
                          >
                            {formatClanIssueListDate(issue)}
                          </span>
                        </td>
                        
                        {/* 제목 */}
                        <td className="ui-td">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {issue.summary || t("admin.clan.table.noTitle")}
                          </div>
                          {hasAlerts && (
                            <div className="mt-1 flex flex-col gap-1">
                              <div className="flex flex-wrap gap-1">
                                {activeAlerts.map((alert, idx) => (
                                  <span
                                    key={idx}
                                    className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.medium}`}
                                  >
                                    {alertTypeLabel[alert.type as keyof typeof alertTypeLabel] || alert.type}
                                  </span>
                                ))}
                              </div>
                              {/* 중복 홍보 시 관련 글 + 링크 같이 보기 */}
                              {activeAlerts.some(a => a.type === 'duplicate_promotion' && (a.relatedIssueIds?.length || a.relatedIssues?.length)) && (() => {
                                const dupAlert = activeAlerts.find(a => a.type === 'duplicate_promotion');
                                const fromApi = dupAlert?.relatedIssues || [];
                                const relatedIds = dupAlert?.relatedIssueIds || fromApi.map(r => r.id);
                                const isExpanded = expandedRelatedIssueId === issue.id;
                                const cacheKey = relatedIds.sort().join(',');
                                const cached = relatedIssuesCache[cacheKey];
                                const fromCurrent = relatedIds.map(id => issues.find(i => i.id === id)).filter((i): i is ClanIssue => i != null);
                                const list = fromApi.length > 0
                                  ? fromApi
                                  : (cached ?? fromCurrent).map((i) => ({
                                      id: i.id,
                                      summary: i.summary || "",
                                      sourceUrl: i.sourceUrl ?? null,
                                      date: i.date,
                                      createdAt: i.createdAt,
                                      sourceCreatedAt: i.sourceCreatedAt,
                                    }));
                                return (
                                  <div className="mt-1">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (isExpanded) {
                                          setExpandedRelatedIssueId(null);
                                          return;
                                        }
                                        setExpandedRelatedIssueId(issue.id);
                                        if (fromApi.length === 0 && fromCurrent.length < relatedIds.length && !cached) {
                                          try {
                                            const params = new URLSearchParams({ ids: relatedIds.join(','), limit: '50' });
                                            if (startDate) params.append('startDate', startDate);
                                            if (endDate) params.append('endDate', endDate);
                                            const res = await fetch(`/api/issues/clan?${params}`, { headers: authHeaders });
                                            if (res.ok) {
                                              const body = await res.json();
                                              const arr: ClanIssue[] = body.data?.issues || body.issues || [];
                                              setRelatedIssuesCache(prev => ({ ...prev, [cacheKey]: arr }));
                                            }
                                          } catch (e) { console.error('Failed to fetch related issues', e); }
                                        }
                                      }}
                                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                      {isExpanded ? "▼" : "▶"}{" "}
                                      {isExpanded
                                        ? t("admin.clan.duplicate.collapse", { n: relatedIds.length })
                                        : t("admin.clan.duplicate.expand", { n: relatedIds.length })}
                                    </button>
                                    {isExpanded && (
                                      <ul className="mt-1 ml-3 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                                        {list.length > 0 ? (
                                          list.map(rel => (
                                            <li key={rel.id} className="flex flex-col gap-0.5 p-1.5 rounded bg-slate-50 dark:bg-slate-700/50">
                                              <span className="truncate" title={rel.summary || ''}>
                                                {rel.summary || t("admin.clan.table.noTitle")}
                                              </span>
                                              {(rel.sourceCreatedAt || rel.createdAt || rel.date) && (
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                                  {t("admin.clan.duplicate.written")}{" "}
                                                  {formatClanIssueListDate({
                                                    date: rel.date,
                                                    sourceCreatedAt: rel.sourceCreatedAt,
                                                    createdAt: rel.createdAt,
                                                  })}
                                                </span>
                                              )}
                                              {rel.sourceUrl && (
                                                <a
                                                  href={rel.sourceUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1 shrink-0"
                                                >
                                                  {t("admin.clan.duplicate.originalLink")}
                                                </a>
                                              )}
                                            </li>
                                          ))
                                        ) : (
                                          <li className="text-slate-500">
                                            {t("admin.clan.duplicate.relatedIds", { ids: relatedIds.join(", ") })}
                                          </li>
                                        )}
                                      </ul>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </td>
                        
                        {/* 게시판 */}
                        <td className="ui-td text-slate-600 dark:text-slate-400">
                          {issue.monitoredBoard?.name || '-'}
                        </td>
                        
                        {/* 작업 */}
                        <td className="ui-td">
                          {issue.sourceUrl && (
                            <a
                              href={issue.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {t("admin.clan.table.viewOriginal")}
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="ui-card ui-card-pad mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  variant="outline"
                  size="sm"
                  className="min-w-[4.5rem] justify-center dark:bg-slate-800 dark:border-slate-600"
                >
                  {t("admin.clan.pagination.prev")}
                </Button>
                <span className="px-2 py-1 text-sm text-slate-700 dark:text-slate-300 tabular-nums text-center">
                  {currentPage} / {totalPages}
                  <span className="block sm:inline sm:ml-1 text-xs text-slate-500 dark:text-slate-400">
                    {t("admin.clan.pagination.total", {
                      n: (filterAlertsOnly || filterAlertType) ? filteredIssues.length : total,
                    })}
                  </span>
                </span>
                <Button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  variant="outline"
                  size="sm"
                  className="min-w-[4.5rem] justify-center dark:bg-slate-800 dark:border-slate-600"
                >
                  {t("admin.clan.pagination.next")}
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
