import { Fragment, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/ui/Button";
import { cn } from "../../utils/cn";
import { createAuthHeaders, createJsonHeaders } from "../../utils/headers";
import { kstCalendarDateMinusDays, kstCalendarDateString } from "../../utils/formatters";
import { useCrawlerGames } from "../../hooks/useCrawlerGames";
import { shortCafeGameTableLabel } from "../../utils/cafeGameDisplay";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { NoticeScreenshotImage } from "../../components/NoticeScreenshotImage";

interface WorkerStatus {
  status: 'running' | 'stopped' | 'unknown';
  pid: number | null;
  lastCheck: string;
}

interface MonitoringStatus {
  naverCafe: WorkerStatus;
  naverCafeClan: WorkerStatus;
  naverCafeBackfill: WorkerStatus;
  discord: WorkerStatus;
  discourseInzoi: WorkerStatus;
}

interface MonitoringKeyword {
  id: number;
  type: 'discord' | 'naver' | 'system';
  word: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RawLog {
  id: string;
  source: string;
  content: string;
  author: string | null;
  timestamp: string;
  isProcessed: boolean;
  metadata: string | null;
  createdAt: string;
  projectName?: string | null;
  projectId?: number | null;
}

type ParsedLogMeta = {
  title?: string | null;
  url?: string | null;
  requiresLogin?: boolean;
  hasKeywordMatch?: boolean;
  hasImages?: boolean;
  screenshotPath?: string | null;
  discourseImageUrl?: string | null;
  discourseTags?: string[] | null;
  discourseViews?: number | null;
  discourseReplyCount?: number | null;
  discourseLikeCount?: number | null;
  discourseLastPostedAt?: string | null;
  discourseBumpedAt?: string | null;
  discourseTopicCreatedAt?: string | null;
  discourseCategoryName?: string | null;
  discourseExcerpt?: string | null;
  closed?: boolean | null;
  archived?: boolean | null;
  pinned?: boolean | null;
};

function safeParseMetadata(raw: string | null): ParsedLogMeta {
  if (!raw) return {};
  try {
    const m = JSON.parse(raw);
    return typeof m === "object" && m ? (m as ParsedLogMeta) : {};
  } catch {
    return {};
  }
}

/** 모니터링 API URL에 사용할 단일 숫자 board id (쉼표 구분 등이면 null — 잘못된 경로 404 방지) */
function coerceSingleBoardId(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
}

/** 크롤링 타겟 테이블: 마지막 스캔 열을 짧게 (KST, 상대시간 축약) */
function formatBoardLastScanCompact(
  lastScanAt: string,
  opts: {
    daysAgoLabel: (n: number) => string;
    hoursAgoLabel: (n: number) => string;
    minutesAgoLabel: (n: number) => string;
    justNowLabel: () => string;
  }
): { main: string; sub: string } {
  const date = new Date(lastScanAt);
  const diffMs = Date.now() - date.getTime();
  const minutesAgo = Math.floor(diffMs / 60000);
  const hoursAgo = Math.floor(minutesAgo / 60);
  const daysAgo = Math.floor(hoursAgo / 24);

  let sub = '';
  if (daysAgo > 0) sub = opts.daysAgoLabel(daysAgo);
  else if (hoursAgo > 0) sub = opts.hoursAgoLabel(hoursAgo);
  else if (minutesAgo > 0) sub = opts.minutesAgoLabel(minutesAgo);
  else sub = opts.justNowLabel();

  // sv-SE: "YYYY-MM-DD HH:mm:ss" → "MM-DD HH:mm"
  const sv = date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  const main = sv.length >= 16 ? sv.slice(5, 16) : sv;

  return { main, sub };
}

/** 클랜 전용 워커는 MonitoredBoard.lastScanAt을 갱신하지 않고 MonitoringConfig에만 기록함 */
function getBoardEffectiveLastScanAt(board: {
  lastScanAt?: string | null;
  lastScanAtClanWorker?: string | null;
}): string | null {
  return board.lastScanAtClanWorker || board.lastScanAt || null;
}

function boardShowsClanWorkerLabel(board: {
  clanWorkerTarget?: boolean;
  lastScanAtClanWorker?: string | null;
}): boolean {
  return Boolean(board.clanWorkerTarget ?? (board.lastScanAtClanWorker != null && board.lastScanAtClanWorker !== ""));
}

type MonitoredBoardRow = {
  id: number;
  name?: string | null;
  label?: string | null;
  project?: { id: number; name: string } | null;
  projectId?: number | null;
  clanWorkerTarget?: boolean;
  clanWorkerResolvedListUrl?: string | null;
  lastScanAt?: string | null;
  lastScanAtClanWorker?: string | null;
};

function groupMonitoredBoardsByProject<T extends MonitoredBoardRow>(
  boards: T[],
  projectsList: { id: number; name?: string | null }[] = [],
  labels: { unassigned: string; unknownProject: string; locale: string } = {
    unassigned: "프로젝트 미지정",
    unknownProject: "프로젝트 정보 없음",
    locale: "ko",
  }
) {
  const map = new Map<
    string,
    { key: string; projectId: number | null; label: string; boards: T[] }
  >();
  for (const board of boards) {
    const pid = board.project?.id ?? board.projectId ?? null;
    const key = pid == null ? "__none__" : String(pid);
    const label =
      pid == null
        ? labels.unassigned
        : (board.project?.name && board.project.name.trim()) ||
          projectsList.find((p) => p.id === pid)?.name?.trim() ||
          labels.unknownProject;
    if (!map.has(key)) {
      map.set(key, { key, projectId: pid, label, boards: [] });
    }
    map.get(key)!.boards.push(board);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    if (g.projectId != null) {
      const fromAnyBoard = g.boards
        .map((b) => b.project?.name?.trim())
        .find((n) => n);
      const fromList = projectsList.find((p) => p.id === g.projectId)?.name?.trim();
      g.label = fromAnyBoard || fromList || labels.unknownProject;
    }
  }
  groups.sort((a, b) => {
    if (a.projectId == null && b.projectId != null) return 1;
    if (a.projectId != null && b.projectId == null) return -1;
    return a.label.localeCompare(b.label, labels.locale);
  });
  for (const g of groups) {
    g.boards.sort((x, y) => {
      const nx = (x.name || x.label || "").localeCompare(y.name || y.label || "", labels.locale);
      if (nx !== 0) return nx;
      return (x.id || 0) - (y.id || 0);
    });
  }
  return groups;
}

export default function MonitoringControl() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token, user } = useAuth();
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [keywords, setKeywords] = useState<MonitoringKeyword[]>([]);
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [logsDiscourseOnly, setLogsDiscourseOnly] = useState(false);
  const [logsSelectedTag, setLogsSelectedTag] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState({ type: 'naver' as const, word: '', enabled: true });
  const [configs, setConfigs] = useState({
    scanInterval: '60',
    cooldown: '5',
    naverCafeCookie: '',
    excludedBoards: '', // 줄바꿈으로 구분된 수집 제외 게시판 목록
    clanBoardIds: '' // 클랜 크롤러 대상 게시판 ID (쉼표 구분). 비우면 이름 패턴으로 자동 선택
  });
  const [cookieStatus, setCookieStatus] = useState<'loading' | 'set' | 'not-set'>('loading');
  const [activeTab, setActiveTab] = useState<'status' | 'boards' | 'keywords' | 'logs' | 'settings'>('status');
  
  // 게시판 관리 상태
  const [monitoredBoards, setMonitoredBoards] = useState<any[]>([]);
  const [editingMonitoredBoard, setEditingMonitoredBoard] = useState<any | null>(null);
  const [showMonitoredBoardForm, setShowMonitoredBoardForm] = useState(false);
  const [loadingMonitoredBoards, setLoadingMonitoredBoards] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  // 일일 게시글 수 모달
  const [dailyCountBoard, setDailyCountBoard] = useState<any | null>(null);
  const [dailyCountData, setDailyCountData] = useState<{ date: string; count: number }[]>([]);
  const [dailyCountMeta, setDailyCountMeta] = useState<{ lastScanAt: string | null; totalRawLogCount: number } | null>(null);
  const [dailyCountError, setDailyCountError] = useState<string | null>(null);
  const [loadingDailyCount, setLoadingDailyCount] = useState(false);
  const [dailyCountStartDate, setDailyCountStartDate] = useState('');
  const [dailyCountEndDate, setDailyCountEndDate] = useState('');
  const [dailyCountFromList, setDailyCountFromList] = useState<{ date: string; count: number }[]>([]);
  const [loadingFromList, setLoadingFromList] = useState(false);
  const [dailyCountFromListTotal, setDailyCountFromListTotal] = useState<number | null>(null);
  const [dailyCountIssueData, setDailyCountIssueData] = useState<{ date: string; count: number }[]>([]);
  const [triggerScanLoading, setTriggerScanLoading] = useState(false);
  const [triggerScanMessage, setTriggerScanMessage] = useState<string | null>(null);

  const authHeaders = createAuthHeaders(token) ?? {};
  const jsonHeaders = createJsonHeaders(token);
  const { games: crawlerGames, lookups: crawlerLookups, defaultCafeGameCode } =
    useCrawlerGames(token);
  const canEditBoards = user?.role === "ADMIN" || user?.role === "LEAD";
  const boardTableColSpan = canEditBoards ? 10 : 9;

  const dateLocale = i18n.language === "ko" ? "ko-KR" : "en-US";

  const filteredLogs = useMemo(() => {
    let rows = logs;
    if (logsDiscourseOnly) {
      rows = rows.filter((l) => l.source === "discourse");
    }
    if (logsSelectedTag) {
      const tag = logsSelectedTag.toLowerCase();
      rows = rows.filter((l) => {
        const meta = safeParseMetadata(l.metadata);
        const tags = Array.isArray(meta.discourseTags) ? meta.discourseTags : [];
        return tags.some((t) => String(t).toLowerCase() === tag);
      });
    }
    return rows;
  }, [logs, logsDiscourseOnly, logsSelectedTag]);

  const boardProjectGroups = useMemo(
    () =>
      groupMonitoredBoardsByProject(monitoredBoards, projects, {
        unassigned: t("admin.monitoring.projects.unassigned"),
        unknownProject: t("admin.monitoring.projects.unknown"),
        locale: i18n.language === "ko" ? "ko" : "en",
      }),
    [monitoredBoards, projects, t, i18n.language]
  );

  const lastScanProjectGroups = useMemo(
    () =>
      groupMonitoredBoardsByProject(
        monitoredBoards.filter(
          (board) => board.isActive !== false && board.enabled !== false
        ),
        projects,
        {
          unassigned: t("admin.monitoring.projects.unassigned"),
          unknownProject: t("admin.monitoring.projects.unknown"),
          locale: i18n.language === "ko" ? "ko" : "en",
        }
      ),
    [monitoredBoards, projects, t, i18n.language]
  );

  /** 목록 기준 조회는 최근 N페이지 전체를 긁은 뒤, 화면에서 선택한 시작·종료일로만 보여줌 */
  const dailyCountFromListFiltered = useMemo(() => {
    const rows = dailyCountFromList;
    if (!dailyCountStartDate && !dailyCountEndDate) return rows;
    return rows.filter((r) => {
      if (dailyCountStartDate && r.date < dailyCountStartDate) return false;
      if (dailyCountEndDate && r.date > dailyCountEndDate) return false;
      return true;
    });
  }, [dailyCountFromList, dailyCountStartDate, dailyCountEndDate]);

  // 상태 로드
  const loadStatus = async () => {
    try {
      const res = await fetch('/api/monitoring/status', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStatus(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to load status', error);
    }
  };

  // 키워드 로드
  const loadKeywords = async () => {
    try {
      const res = await fetch('/api/monitoring/keywords', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setKeywords(data.data || []);
        }
      }
    } catch (error) {
      console.error('Failed to load keywords', error);
    }
  };

  // 로그 로드
  const loadLogs = async () => {
    setLoading(true);
    try {
      // 날짜 필터 제거: 모든 로그 표시
      // (필요시 최근 24시간 데이터만 보려면 아래 주석 해제)
      // const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      // const res = await fetch(`/api/monitoring/logs?limit=50&startDate=${yesterday}`, { headers: authHeaders });
      const res = await fetch('/api/monitoring/logs?limit=50', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          // data.data가 직접 logs 배열이거나, data.data.logs일 수 있음
          const logsArray = Array.isArray(data.data) ? data.data : (data.data.logs || []);
          setLogs(logsArray);
        } else {
          console.error('Failed to load logs: Invalid response', data);
          setLogs([]);
        }
      } else {
        const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
        console.error('Failed to load logs:', errorData);
        setLogs([]);
      }
    } catch (error) {
      console.error('Failed to load logs', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  // 키워드 추가
  const handleAddKeyword = async () => {
    if (!newKeyword.word.trim()) {
      alert(t("admin.monitoring.alerts.enterKeyword"));
      return;
    }

    try {
      const res = await fetch('/api/monitoring/keywords', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(newKeyword)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setNewKeyword({ type: 'naver', word: '', enabled: true });
          loadKeywords();
        } else {
          alert(data.message || t("admin.monitoring.alerts.addKeywordFailed"));
        }
      } else {
        const error = await res.json();
        alert(error.message || t("admin.monitoring.alerts.addKeywordFailed"));
      }
    } catch (error) {
      console.error('Failed to add keyword', error);
      alert(t("admin.monitoring.alerts.addKeywordError"));
    }
  };

  // 키워드 삭제
  const handleDeleteKeyword = async (id: number) => {
    if (!confirm(t("admin.monitoring.alerts.confirmDelete"))) return;

    try {
      const res = await fetch(`/api/monitoring/keywords/${id}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      if (res.ok) {
        loadKeywords();
      } else {
        alert(t("admin.monitoring.alerts.deleteKeywordFailed"));
      }
    } catch (error) {
      console.error('Failed to delete keyword', error);
      alert(t("admin.monitoring.alerts.deleteKeywordError"));
    }
  };

  // 설정 저장
  const handleSaveConfig = async (key: string, value: string, description?: string) => {
    try {
      const res = await fetch(`/api/monitoring/config/${key}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ value, description })
      });

      if (res.ok) {
        if (key === 'naverCafeCookie') {
          setCookieStatus(value ? 'set' : 'not-set');
        }
        alert(t("admin.monitoring.alerts.settingsSaved"));
        loadConfigs();
      } else {
        alert(t("admin.monitoring.alerts.settingsSaveFailed"));
      }
    } catch (error) {
      console.error('Failed to save config', error);
      alert(t("admin.monitoring.alerts.settingsSaveError"));
    }
  };

  // 설정 로드
  const loadConfigs = async () => {
    try {
      const [intervalRes, cooldownRes, cookieRes, excludedBoardsRes, clanBoardIdsRes] = await Promise.all([
        fetch('/api/monitoring/config/crawler.interval', { headers: authHeaders }).catch(() => ({ ok: false, status: 404 })),
        fetch('/api/monitoring/config/alert.cooldown', { headers: authHeaders }).catch(() => ({ ok: false, status: 404 })),
        fetch('/api/monitoring/config/naverCafeCookie', { headers: authHeaders }).catch(() => ({ ok: false, status: 404 })),
        fetch('/api/monitoring/config/naver.excludedBoards', { headers: authHeaders }).catch(() => ({ ok: false, status: 404 })),
        fetch('/api/monitoring/config/naver.clanBoardIds', { headers: authHeaders }).catch(() => ({ ok: false, status: 404 }))
      ]);
      
      // 404는 무시 (설정이 없는 경우)
      if (intervalRes.ok && intervalRes.status !== 404 && intervalRes instanceof Response) {
        try {
          const data = await intervalRes.json();
          if (data.success && data.data) {
            setConfigs(prev => ({ ...prev, scanInterval: data.data.value || '60' }));
          }
        } catch (e) {
          // JSON 파싱 실패 무시
        }
      }
      
      if (cooldownRes.ok && cooldownRes.status !== 404 && 'json' in cooldownRes) {
        try {
          const data = await (cooldownRes as Response).json();
          if (data.success && data.data) {
            setConfigs(prev => ({ ...prev, cooldown: data.data.value || '5' }));
          }
        } catch (e) {
          // JSON 파싱 실패 무시
        }
      }
      
      if (cookieRes.ok && cookieRes.status !== 404 && 'json' in cookieRes) {
        try {
          const data = await (cookieRes as Response).json();
          if (data.success && data.data && data.data.value) {
            setConfigs(prev => ({ ...prev, naverCafeCookie: data.data.value }));
            setCookieStatus('set');
          } else {
            setCookieStatus('not-set');
          }
        } catch (e) {
          setCookieStatus('not-set');
        }
      } else {
        setCookieStatus('not-set');
      }

      // 수집 제외 게시판 설정 로드
      if (excludedBoardsRes.ok && excludedBoardsRes.status !== 404 && 'json' in excludedBoardsRes) {
        try {
          const data = await (excludedBoardsRes as Response).json();
          if (data.success && data.data && data.data.value) {
            try {
              const parsed = JSON.parse(data.data.value);
              if (Array.isArray(parsed)) {
                const text = parsed
                  .map((name: unknown) => String(name || '').trim())
                  .filter((name: string) => name.length > 0)
                  .join('\n');
                setConfigs(prev => ({ ...prev, excludedBoards: text }));
              }
            } catch {
              // JSON 파싱 실패 시 원시 값 그대로 사용
              setConfigs(prev => ({ ...prev, excludedBoards: data.data.value }));
            }
          }
        } catch {
          // 무시
        }
      }

      // 클랜 크롤러 대상 게시판 ID 설정 로드
      if (clanBoardIdsRes.ok && clanBoardIdsRes.status !== 404 && 'json' in clanBoardIdsRes) {
        try {
          const data = await (clanBoardIdsRes as Response).json();
          if (data.success && data.data && data.data.value) {
            setConfigs(prev => ({ ...prev, clanBoardIds: String(data.data.value).trim() }));
          }
        } catch {
          // 무시
        }
      }
    } catch (error) {
      console.error('Failed to load configs', error);
      setCookieStatus('not-set');
    }
  };

  // 프로젝트 목록 로드
  const loadProjects = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/projects', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const projectList = data.data || data.projects || [];
        setProjects(Array.isArray(projectList) ? projectList : []);
      }
    } catch (error) {
      console.error('Failed to load projects', error);
      setProjects([]);
    }
  };

  // 게시판 로드 (새로운 API 사용)
  const loadMonitoredBoards = async () => {
    if (!token) {
      console.warn('[MonitoringControl] No token, skipping board load');
      return;
    }
    setLoadingMonitoredBoards(true);
    try {
      const res = await fetch('/api/monitoring/boards', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        console.log('[MonitoringControl] Boards loaded', { 
          success: data.success, 
          count: Array.isArray(data.data) ? data.data.length : 0,
          dataType: Array.isArray(data.data) ? 'array' : typeof data.data
        });
        if (data.success && Array.isArray(data.data)) {
          setMonitoredBoards(data.data);
        } else if (Array.isArray(data)) {
          // 하위 호환성
          setMonitoredBoards(data);
        } else {
          console.warn('[MonitoringControl] Unexpected data format', data);
          setMonitoredBoards([]);
        }
      } else {
        const errorData = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        console.error('[MonitoringControl] Failed to load boards', {
          status: res.status,
          statusText: res.statusText,
          error: errorData
        });
        if (res.status === 403) {
          console.error('[MonitoringControl] Access denied - ADMIN or LEAD role required');
        }
        setMonitoredBoards([]);
      }
    } catch (error) {
      console.error('[MonitoringControl] Failed to load monitored boards', error);
      setMonitoredBoards([]);
    } finally {
      setLoadingMonitoredBoards(false);
    }
  };

  // 게시판 저장 (새로운 API 사용)
  const handleSaveMonitoredBoard = async () => {
    if (!editingMonitoredBoard) return;
    
    // 필수 필드 검증
    const boardUrl = (editingMonitoredBoard.url || editingMonitoredBoard.listUrl || '').trim();
    const boardName = (editingMonitoredBoard.name || '').trim();
    
    if (!boardUrl) {
      alert(t("admin.monitoring.alerts.enterBoardUrl"));
      return;
    }
    
    if (!boardName) {
      alert(t("admin.monitoring.alerts.enterBoardName"));
      return;
    }
    
    const isNew = !editingMonitoredBoard.id;
    const existingId = !isNew ? coerceSingleBoardId(editingMonitoredBoard.id) : null;
    if (!isNew && existingId == null) {
      alert(t("admin.monitoring.alerts.invalidBoardId"));
      return;
    }
    const url = isNew ? "/api/monitoring/boards" : `/api/monitoring/boards/${existingId}`;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      // 새로운 API 형식에 맞게 데이터 변환
      const payload = isNew
        ? {
            url: boardUrl,
            name: boardName,
            cafeGame: editingMonitoredBoard.cafeGame || defaultCafeGameCode,
            label: (editingMonitoredBoard.label || '').trim() || boardName,
            interval: editingMonitoredBoard.interval || editingMonitoredBoard.checkInterval || 300,
            checkInterval: editingMonitoredBoard.checkInterval || editingMonitoredBoard.interval || 300,
            projectId: editingMonitoredBoard.projectId || null
          }
        : {
            ...(editingMonitoredBoard.url && { url: editingMonitoredBoard.url }),
            ...(editingMonitoredBoard.name && { name: editingMonitoredBoard.name }),
            ...(editingMonitoredBoard.label !== undefined && { label: editingMonitoredBoard.label }),
            ...(editingMonitoredBoard.cafeGame && { cafeGame: editingMonitoredBoard.cafeGame }),
            ...(editingMonitoredBoard.enabled !== undefined && { enabled: editingMonitoredBoard.enabled }),
            ...(editingMonitoredBoard.isActive !== undefined && { isActive: editingMonitoredBoard.isActive }),
            ...(editingMonitoredBoard.interval !== undefined && { interval: editingMonitoredBoard.interval }),
            ...(editingMonitoredBoard.checkInterval !== undefined && { checkInterval: editingMonitoredBoard.checkInterval }),
            ...(editingMonitoredBoard.projectId !== undefined && { projectId: editingMonitoredBoard.projectId })
          };

      const res = await fetch(url, {
        method,
        headers: jsonHeaders,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success || res.status === 200 || res.status === 201) {
          setShowMonitoredBoardForm(false);
          setEditingMonitoredBoard(null);
          loadMonitoredBoards();
        } else {
          const errorMsg = data.error || data.message || t("admin.monitoring.alerts.saveBoardFailedDefault");
          console.error('Board save failed:', data);
          alert(errorMsg);
        }
      } else {
        let errorData;
        try {
          errorData = await res.json();
        } catch (e) {
          errorData = { error: t("admin.monitoring.alerts.saveBoardFailedStatus", { status: res.status }) };
        }
        const errorMsg =
          errorData.error ||
          errorData.message ||
          t("admin.monitoring.alerts.saveBoardFailedStatus", { status: res.status });
        console.error('Board save failed:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData,
          payload: payload
        });
        alert(errorMsg);
      }
    } catch (error) {
      console.error('Failed to save monitored board', error);
      const errorMessage =
        error instanceof Error ? error.message : t("admin.monitoring.alerts.unknownErrorShort");
      alert(t("admin.monitoring.alerts.saveBoardError", { message: errorMessage }));
    }
  };

  // 게시판 일일 게시글 수 로드
  const loadDailyPostCount = async (boardId: unknown, startDate?: string, endDate?: string) => {
    const id = coerceSingleBoardId(boardId);
    setDailyCountError(null);
    if (id == null) {
      setDailyCountData([]);
      setDailyCountError(t("admin.monitoring.alerts.dailyInvalidBoardId"));
      return;
    }
    setLoadingDailyCount(true);
    try {
      let url = `/api/monitoring/boards/${id}/daily-post-count`;
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (params.toString()) url += `?${params.toString()}`;
      const res = await fetch(url, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const payload = data.data || data;
        setDailyCountData(payload.dailyCounts || []);
        setDailyCountIssueData(payload.dailyCountsIssueIngestKst || []);
        setDailyCountMeta({
          lastScanAt: payload.lastScanAt ?? null,
          totalRawLogCount: typeof payload.totalRawLogCount === 'number' ? payload.totalRawLogCount : 0
        });
      } else {
        setDailyCountData([]);
        setDailyCountIssueData([]);
        setDailyCountMeta(null);
        if (res.status === 404) {
          setDailyCountError(t("admin.monitoring.alerts.dailyBoardNotFoundOrPath"));
        } else {
          setDailyCountError(t("admin.monitoring.alerts.dailyQueryFailedStatus", { status: res.status }));
        }
      }
    } catch {
      setDailyCountData([]);
      setDailyCountIssueData([]);
      setDailyCountMeta(null);
      setDailyCountError(t("admin.monitoring.alerts.requestError"));
    } finally {
      setLoadingDailyCount(false);
    }
  };

  const openDailyCountModal = (board: any) => {
    if (coerceSingleBoardId(board?.id) == null) {
      alert(t("admin.monitoring.alerts.invalidBoardId"));
      return;
    }
    const end = kstCalendarDateString();
    const start = kstCalendarDateMinusDays(30);
    setDailyCountStartDate(start);
    setDailyCountEndDate(end);
    setDailyCountBoard(board);
    setDailyCountData([]);
    setDailyCountIssueData([]);
    setDailyCountMeta(null);
    setDailyCountError(null);
    setDailyCountFromList([]);
    setDailyCountFromListTotal(null);
    loadDailyPostCount(board.id, start, end);
  };

  const applyDailyCountRange = () => {
    if (dailyCountBoard) {
      loadDailyPostCount(
        dailyCountBoard.id,
        dailyCountStartDate || undefined,
        dailyCountEndDate || undefined
      );
    }
  };

  /** 목록 기준: 게시판 접속 → 50개씩 목록에서 날짜 셀 파싱 → 같은 날짜 건수 집계 */
  const loadDailyPostCountFromList = async () => {
    const bid = dailyCountBoard ? coerceSingleBoardId(dailyCountBoard.id) : null;
    if (bid == null) return;
    setLoadingFromList(true);
    setDailyCountFromList([]);
    setDailyCountFromListTotal(null);
    try {
      const res = await fetch(
        `/api/monitoring/boards/${bid}/daily-post-count-from-list?maxPages=10`,
        { headers: authHeaders }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.data || data.dailyCounts)) {
        const payload = data.data || data;
        setDailyCountFromList(payload.dailyCounts || []);
        setDailyCountFromListTotal(payload.totalRows ?? null);
      }
    } finally {
      setLoadingFromList(false);
    }
  };

  // 수동 크롤링 트리거 (Naver Cafe 워커에 스캔 요청)
  const handleTriggerScan = async () => {
    setTriggerScanMessage(null);
    setTriggerScanLoading(true);
    try {
      const res = await fetch('/api/monitoring/trigger-scan', {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.success || data.message)) {
        setTriggerScanMessage(t("admin.monitoring.alerts.triggerSent"));
        loadStatus();
        loadMonitoredBoards();
      } else {
        setTriggerScanMessage(data.error || data.message || `요청 실패 (${res.status})`);
      }
    } catch (e) {
      setTriggerScanMessage(t("admin.monitoring.alerts.requestError"));
    } finally {
      setTriggerScanLoading(false);
    }
  };

  // 게시판 삭제 (새로운 API 사용)
  const handleDeleteMonitoredBoard = async (id: number) => {
    if (!confirm(t("admin.monitoring.alerts.confirmDelete"))) return;
    const bid = coerceSingleBoardId(id);
    if (bid == null) {
      alert(t("admin.monitoring.alerts.dailyInvalidBoardId"));
      return;
    }

    try {
      const res = await fetch(`/api/monitoring/boards/${bid}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success || res.status === 200) {
          loadMonitoredBoards();
        } else {
          alert(data.error || t("admin.monitoring.alerts.deleteBoardFailed"));
        }
      } else {
        const error = await res.json();
        alert(error.error || error.message || t("admin.monitoring.alerts.deleteBoardFailed"));
      }
    } catch (error) {
      console.error('Failed to delete monitored board', error);
      alert(t("admin.monitoring.alerts.deleteBoardError"));
    }
  };

  // 게시판 활성/비활성 토글
  const handleToggleBoardStatus = async (id: number, currentStatus: boolean) => {
    const bid = coerceSingleBoardId(id);
    if (bid == null) {
      alert(t("admin.monitoring.alerts.dailyInvalidBoardId"));
      return;
    }
    try {
      const res = await fetch(`/api/monitoring/boards/${bid}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ isActive: !currentStatus, enabled: !currentStatus })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success || res.status === 200) {
          loadMonitoredBoards();
        } else {
          alert(data.error || t("admin.monitoring.alerts.toggleStatusFailed"));
        }
      } else {
        const error = await res.json();
        alert(error.error || error.message || t("admin.monitoring.alerts.toggleStatusFailed"));
      }
    } catch (error) {
      console.error('Failed to toggle board status', error);
      alert(t("admin.monitoring.alerts.toggleStatusError"));
    }
  };

  // 초기 로드
  useEffect(() => {
    loadStatus();
    loadKeywords();
    loadConfigs();
    loadMonitoredBoards();
    loadProjects();
    
    // 상태는 10초마다 자동 새로고침
    const statusInterval = setInterval(loadStatus, 10000);
    
    return () => clearInterval(statusInterval);
  }, [token]);

  // 탭 변경 시 로그 로드
  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs();
    } else if (activeTab === 'boards') {
      loadMonitoredBoards();
    } else if (activeTab === 'status') {
      // 상태 탭에서도 게시판 데이터 필요 (차트용)
      loadMonitoredBoards();
    }
  }, [activeTab, token]);

  // 로그 탭에서 자동 새로고침 (30초마다)
  useEffect(() => {
    if (activeTab === 'logs') {
      const interval = setInterval(loadLogs, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, token]);

  // 게시판 목록 자동 새로고침 (30초마다)
  useEffect(() => {
    if (activeTab === 'boards' || activeTab === 'status') {
      const interval = setInterval(loadMonitoredBoards, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, token]);

  const StatusIndicator: React.FC<{ status: string }> = ({ status }) => {
    const isRunning = status === 'running';
    return (
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            isRunning ? 'bg-green-500 dark:bg-green-400' : 'bg-red-500 dark:bg-red-400'
          }`}
        />
        <span className={isRunning ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
          {isRunning ? 'Running' : 'Stopped'}
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">{t("admin.monitoring.title")}</h1>
          <div className="flex gap-3">
            <a
              href="/"
              className="px-4 py-2 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {t("admin.monitoring.dashboard")}
            </a>
            <a
              href="/admin"
              className="px-4 py-2 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {t("admin.monitoring.admin")}
            </a>
          </div>
        </div>

        {/* 탭 메뉴 */}
        <div className="ui-card mb-6">
          <div className="flex border-b dark:border-slate-700">
            <button
              onClick={() => setActiveTab('status')}
              className={cn(
                "ui-tab",
                activeTab === 'status' ? "ui-tab-active text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400" : "text-slate-500 dark:text-slate-400"
              )}
            >
              {t("admin.monitoring.tabs.status")}
            </button>
            <button
              onClick={() => setActiveTab('boards')}
              className={cn(
                "ui-tab",
                activeTab === 'boards' ? "ui-tab-active text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400" : "text-slate-500 dark:text-slate-400"
              )}
            >
              {t("admin.monitoring.tabs.boards")}
            </button>
            <button
              onClick={() => setActiveTab('keywords')}
              className={cn(
                "ui-tab",
                activeTab === 'keywords' ? "ui-tab-active text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400" : "text-slate-500 dark:text-slate-400"
              )}
            >
              {t("admin.monitoring.tabs.keywords")}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={cn(
                "ui-tab",
                activeTab === 'logs' ? "ui-tab-active text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400" : "text-slate-500 dark:text-slate-400"
              )}
            >
              {t("admin.monitoring.tabs.logs")}
            </button>
            {(user?.role === 'ADMIN' || user?.role === 'LEAD') && (
              <button
                onClick={() => setActiveTab('settings')}
                className={cn(
                  "ui-tab",
                  activeTab === 'settings' ? "ui-tab-active text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400" : "text-slate-500 dark:text-slate-400"
                )}
              >
                {t("admin.monitoring.tabs.settings")}
              </button>
            )}
          </div>
        </div>

        {/* 상태 패널 */}
        {activeTab === 'status' && (
          <div className="space-y-6">
            {/* 워커 상태 */}
            <div className="ui-card ui-card-pad">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{t("admin.monitoring.workerStatus.title")}</h2>
                {(user?.role === 'ADMIN' || user?.role === 'LEAD') && (
                  <div className="flex items-center gap-3">
                    <Button type="button" onClick={handleTriggerScan} disabled={triggerScanLoading} variant="primary">
                      {triggerScanLoading ? t("admin.monitoring.workerStatus.triggering") : t("admin.monitoring.workerStatus.trigger")}
                    </Button>
                    {triggerScanMessage && (
                      <span className="text-sm text-slate-600 dark:text-slate-400">{triggerScanMessage}</span>
                    )}
                  </div>
                )}
              </div>
              {status ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="border dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.statusCards.naverCafe")}
                      </h3>
                      <StatusIndicator status={status.naverCafe.status} />
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      PID: {status.naverCafe.pid || t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {t("admin.monitoring.lastCheck")}:{" "}
                      {new Date(status.naverCafe.lastCheck).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })}
                    </div>
                  </div>
                  <div className="border dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.statusCards.naverCafeClan")}
                      </h3>
                      <StatusIndicator status={status.naverCafeClan?.status || 'unknown'} />
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      PID: {status.naverCafeClan?.pid || t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {t("admin.monitoring.lastCheck")}:{" "}
                      {status.naverCafeClan?.lastCheck
                        ? new Date(status.naverCafeClan.lastCheck).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })
                        : t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">
                      {t("admin.monitoring.statusCards.naverCafeClanNote")}
                    </div>
                  </div>
                  <div className="border dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.statusCards.naverCafeBackfill")}
                      </h3>
                      <StatusIndicator status={status.naverCafeBackfill?.status || 'unknown'} />
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      PID: {status.naverCafeBackfill?.pid || t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {t("admin.monitoring.lastCheck")}:{" "}
                      {status.naverCafeBackfill?.lastCheck
                        ? new Date(status.naverCafeBackfill.lastCheck).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })
                        : t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">
                      {t("admin.monitoring.statusCards.naverCafeBackfillNote")}
                    </div>
                  </div>
                  <div className="border dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.statusCards.discord")}
                      </h3>
                      <StatusIndicator status={status.discord.status} />
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      PID: {status.discord.pid || t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {t("admin.monitoring.lastCheck")}:{" "}
                      {new Date(status.discord.lastCheck).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })}
                    </div>
                  </div>
                  <div className="border dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.statusCards.discourseInzoi")}
                      </h3>
                      <StatusIndicator status={status.discourseInzoi?.status || "unknown"} />
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      PID: {status.discourseInzoi?.pid || t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {t("admin.monitoring.lastCheck")}:{" "}
                      {status.discourseInzoi?.lastCheck
                        ? new Date(status.discourseInzoi.lastCheck).toLocaleString(dateLocale, {
                            timeZone: "Asia/Seoul",
                          })
                        : t("admin.monitoring.na")}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">
                      {t("admin.monitoring.statusCards.discourseInzoiNote")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 dark:text-slate-400 py-8">{t("common.loading", { ns: "translation" })}</div>
              )}
            </div>

            {/* 게시판별 마지막 수집 시간 */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 p-6">
              <h2 className="text-xl font-semibold mb-4 text-slate-800 dark:text-slate-100">{t("admin.monitoring.lastScanByBoardTitle")}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                {t("admin.monitoring.lastScanGuide.line1")}{" "}
                {t("admin.monitoring.lastScanGuide.line2")}{" "}
                {t("admin.monitoring.lastScanGuide.line3")}
              </p>
              {monitoredBoards.length > 0 ? (
                <div className="space-y-6">
                  {lastScanProjectGroups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-200 dark:border-slate-600 pb-1.5">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {group.label}
                        </span>
                        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {t("admin.monitoring.lastScanGuide.activeBoardsCount", { n: group.boards.length })}
                        </span>
                      </div>
                      {[...group.boards]
                        .sort((a, b) => {
                          const aTime = getBoardEffectiveLastScanAt(a)
                            ? new Date(getBoardEffectiveLastScanAt(a)!).getTime()
                            : 0;
                          const bTime = getBoardEffectiveLastScanAt(b)
                            ? new Date(getBoardEffectiveLastScanAt(b)!).getTime()
                            : 0;
                          return bTime - aTime;
                        })
                        .map((board) => {
                          const effectiveAt = getBoardEffectiveLastScanAt(board);
                          const lastScanTime = effectiveAt ? new Date(effectiveAt).getTime() : null;
                          const now = Date.now();
                          const diffMs = lastScanTime ? now - lastScanTime : null;
                          const minutesAgo = diffMs !== null ? Math.floor(diffMs / 60000) : null;
                          const hoursAgo = minutesAgo !== null ? Math.floor(minutesAgo / 60) : null;
                          const daysAgo = hoursAgo !== null ? Math.floor(hoursAgo / 24) : null;

                          let relativeTimeText = "—";
                          if (minutesAgo !== null) {
                            if (daysAgo !== null && daysAgo > 0 && hoursAgo !== null) {
                              relativeTimeText = t("admin.monitoring.lastScanByBoard.relative.daysHoursAgo", {
                                days: daysAgo,
                                hours: hoursAgo % 24,
                              });
                            } else if (hoursAgo !== null && hoursAgo > 0) {
                              relativeTimeText = t("admin.monitoring.lastScanByBoard.relative.hoursMinutesAgo", {
                                hours: hoursAgo,
                                minutes: minutesAgo % 60,
                              });
                            } else if (minutesAgo > 0) {
                              relativeTimeText = t("admin.monitoring.time.minutesAgo", { n: minutesAgo });
                            } else {
                              relativeTimeText = t("admin.monitoring.time.justNow");
                            }
                          }

                          let absoluteTimeText = t("admin.monitoring.lastScanByBoard.relative.neverScanned");
                          if (effectiveAt) {
                            const date = new Date(effectiveAt);
                            absoluteTimeText =
                              date.toLocaleString(dateLocale, {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                timeZone: "Asia/Seoul",
                              }) + t("admin.monitoring.lastScanByBoard.relative.kstSuffix");
                            if (boardShowsClanWorkerLabel(board)) {
                              absoluteTimeText += t("admin.monitoring.lastScanByBoard.relative.clanWorkerOnAbsolute");
                            }
                          }

                          return (
                            <div
                              key={board.id}
                              className="flex items-center justify-between p-3 border dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-700 dark:text-slate-300">
                                  {board.name || board.label || "—"}
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                  {absoluteTimeText}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                  {relativeTimeText}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                  {t("admin.monitoring.status.noActiveBoards")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 크롤링 타겟 관리 */}
        {activeTab === 'boards' && (
          <div className="space-y-6">
            {/* 크롤링 타겟 관리 헤더 */}
            <div className="ui-card ui-card-pad">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{t("admin.monitoring.boards.title")}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {t("admin.monitoring.boards.subtitlePrefix")}{" "}
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {t("admin.monitoring.boards.subtitleStrong")}
                    </span>
                    {t("admin.monitoring.boards.subtitleSuffix")}
                  </p>
                </div>
                {canEditBoards && (
                  <Button
                    onClick={() => {
                      setEditingMonitoredBoard({
                        url: '',
                        name: '',
                        cafeGame: defaultCafeGameCode,
                        label: '',
                        enabled: true,
                        isActive: true,
                        interval: 300, // 기본값 5분 (300초)
                        checkInterval: 300,
                        projectId: null
                      });
                      setShowMonitoredBoardForm(true);
                    }}
                    variant="primary"
                  >
                    {t("admin.monitoring.boards.addBoard")}
                  </Button>
                )}
              </div>
              {/* 게시판 목록 테이블 */}
              {loadingMonitoredBoards ? (
                <div className="text-center text-slate-500 dark:text-slate-400 py-8">{t("common.loading", { ns: "translation" })}</div>
              ) : (
                <div className="w-full min-w-0">
                  <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                    <colgroup>
                      <col style={{ width: "13rem" }} />
                      <col style={{ width: "2.75rem" }} />
                      <col style={{ width: "4.25rem" }} />
                      <col style={{ width: "6.75rem" }} />
                      <col style={{ width: "3rem" }} />
                      <col style={{ width: "6.5rem" }} />
                      <col style={{ width: "2.25rem" }} />
                      <col style={{ width: "2.25rem" }} />
                      <col style={{ width: "3.25rem" }} />
                      {canEditBoards && <col style={{ width: "5.25rem" }} />}
                    </colgroup>
                    <thead className="bg-slate-50 dark:bg-slate-700">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">
                          {t("admin.monitoring.boards.table.name")}
                        </th>
                        <th className="px-1 py-2 text-center text-xs font-medium text-slate-700 dark:text-slate-300">LINK</th>
                        <th
                          className="px-1 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
                          title={t("admin.monitoring.boards.tooltips.naColumn")}
                        >
                          NA
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {t("admin.monitoring.boards.table.status")}
                        </th>
                        <th className="px-1 py-2 text-right text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {t("admin.monitoring.boards.table.interval")}
                        </th>
                        <th
                          className="px-1 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
                          title={t("admin.monitoring.boards.tooltips.lastScanColumn")}
                        >
                          {t("admin.monitoring.boards.table.lastScan")}
                        </th>
                        <th className="px-1 py-2 text-right text-xs font-medium text-slate-700 dark:text-slate-300" title={t("admin.monitoring.boards.table.issueCountTitle")}>
                          {t("admin.monitoring.boards.table.issues")}
                        </th>
                        <th className="px-1 py-2 text-right text-xs font-medium text-slate-700 dark:text-slate-300" title={t("admin.monitoring.boards.table.rawLogCountTitle")}>
                          {t("admin.monitoring.boards.table.collected")}
                        </th>
                        <th className="px-1 py-2 text-center text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap" title={t("admin.monitoring.boards.table.dailyPostCountTitle")}>
                          {t("admin.monitoring.boards.table.dailyPosts")}
                        </th>
                        {canEditBoards && (
                          <th className="px-1 py-2 text-center text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {t("admin.monitoring.boards.table.actions")}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {monitoredBoards.length === 0 ? (
                        <tr>
                          <td colSpan={boardTableColSpan} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                            <p className="text-lg mb-2">{t("admin.monitoring.boards.emptyTitle")}</p>
                            <p className="text-sm">{t("admin.monitoring.boards.emptyHint")}</p>
                          </td>
                        </tr>
                      ) : (
                        boardProjectGroups.map((group) => (
                          <Fragment key={group.key}>
                            <tr className="bg-slate-100/90 dark:bg-slate-800/70">
                              <td
                                colSpan={boardTableColSpan}
                                className="px-2 py-2 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 border-t border-slate-200 dark:border-slate-600"
                              >
                                {group.label}
                                <span className="ml-2 font-normal tabular-nums text-slate-500 dark:text-slate-400">
                                  · {t("admin.monitoring.boards.groupCount", { n: group.boards.length })}
                                </span>
                              </td>
                            </tr>
                            {group.boards.map((board) => (
                          <tr key={board.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 align-middle">
                            <td className="px-2 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 min-w-0 break-words [word-break:break-word]">
                              <span className="block">{board.name || board.label || "—"}</span>
                              {board.clanWorkerTarget && board.clanWorkerResolvedListUrl ? (
                                <span
                                  className="mt-0.5 block text-[10px] font-normal leading-snug text-violet-700 dark:text-violet-300"
                                  title={t("admin.monitoring.boards.clanWorkerResolvedListUrlTitle", { url: board.clanWorkerResolvedListUrl })}
                                >
                                  {t("admin.monitoring.boards.clanWorkerUrlLabel")}{" "}
                                  <span className="break-all opacity-90">{board.clanWorkerResolvedListUrl}</span>
                                </span>
                              ) : null}
                            </td>
                            <td className="px-0 py-2 text-center align-middle">
                              {board.url || board.listUrl ? (
                                <a
                                  href={board.url || board.listUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                  title={board.url || board.listUrl}
                                >
                                  LINK
                                </a>
                              ) : (
                                <span className="text-slate-400 text-[10px]">—</span>
                              )}
                            </td>
                            <td
                              className="px-1 py-2 text-[11px] text-slate-700 dark:text-slate-300 leading-tight whitespace-normal break-words"
                              title={
                                (board.cafeGame &&
                                  crawlerLookups.labelByCode[board.cafeGame]) ||
                                board.cafeGame ||
                                ""
                              }
                            >
                              {shortCafeGameTableLabel(
                                board.cafeGame,
                                crawlerLookups.labelByCode
                              )}
                            </td>
                          <td className="px-2 py-2 text-xs align-middle">
                            {canEditBoards ? (
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={board.isActive !== false && board.enabled !== false}
                                  onChange={() => handleToggleBoardStatus(board.id, board.isActive !== false && board.enabled !== false)}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
                                <span className="ml-2 text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {board.isActive !== false && board.enabled !== false ? 'ON' : 'OFF'}
                                </span>
                              </label>
                            ) : (
                              <span className={board.isActive !== false && board.enabled !== false 
                                ? 'text-green-600 dark:text-green-400 font-medium text-[11px]' 
                                : 'text-slate-400 text-[11px]'}>
                                {board.isActive !== false && board.enabled !== false ? 'ON' : 'OFF'}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-2 text-right text-[11px] text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                            {board.checkInterval || board.interval || 60}s
                          </td>
                          <td className="px-1 py-2 text-[10px] text-slate-600 dark:text-slate-400 whitespace-nowrap tabular-nums">
                            {getBoardEffectiveLastScanAt(board)
                              ? (() => {
                                  const effective = getBoardEffectiveLastScanAt(board)!;
                                  const { main, sub } = formatBoardLastScanCompact(effective, {
                                    daysAgoLabel: (n) => t("admin.monitoring.time.daysAgo", { n }),
                                    hoursAgoLabel: (n) => t("admin.monitoring.time.hoursAgo", { n }),
                                    minutesAgoLabel: (n) => t("admin.monitoring.time.minutesAgo", { n }),
                                    justNowLabel: () => t("admin.monitoring.time.justNow"),
                                  });
                                  const full = new Date(effective).toLocaleString(dateLocale, {
                                    timeZone: 'Asia/Seoul',
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    hour12: true
                                  });
                                  const refParts: string[] = [];
                                  if (
                                    board.lastScanAtClanWorker &&
                                    board.lastScanAt &&
                                    board.lastScanAt !== board.lastScanAtClanWorker
                                  ) {
                                    refParts.push(
                                      t("admin.monitoring.boards.tooltips.monitoredBoardRef", {
                                        at: new Date(board.lastScanAt).toLocaleString(dateLocale, {
                                          timeZone: "Asia/Seoul",
                                        }),
                                      })
                                    );
                                  }
                                  if (
                                    board.clanWorkerTarget &&
                                    !board.lastScanAtClanWorker &&
                                    board.lastScanAt
                                  ) {
                                    refParts.push(
                                      t("admin.monitoring.lastScan.clanNoHistoryNote")
                                    );
                                  }
                                  const refNote = refParts.length ? ` ${refParts.join(" ")}` : "";
                                  return (
                                    <span title={`${full} (${sub})${refNote}`}>
                                      <span className="whitespace-nowrap">
                                        {main} {sub}
                                      </span>
                                      {boardShowsClanWorkerLabel(board) ? (
                                        <span className="block text-[9px] text-violet-600 dark:text-violet-400 leading-tight">
                                          {t("admin.monitoring.boards.clanWorkerBadge")}
                                        </span>
                                      ) : null}
                                    </span>
                                  );
                                })()
                              : <span className="text-slate-400">—</span>}
                          </td>
                          <td
                            className="px-1 py-2 text-right text-xs text-slate-700 dark:text-slate-300 tabular-nums"
                            title={t("admin.monitoring.boards.table.issueCountTitle")}
                          >
                            {board.issueCount ?? 0}
                          </td>
                          <td
                            className="px-1 py-2 text-right text-xs text-slate-700 dark:text-slate-300 tabular-nums"
                            title={t("admin.monitoring.boards.table.rawLogCountTitle")}
                          >
                            {board.rawLogCount ?? 0}
                          </td>
                          <td className="px-0 py-2 text-center whitespace-nowrap">
                            <Button
                              type="button"
                              onClick={() => openDailyCountModal(board)}
                              variant="ghost"
                              size="sm"
                              className="!px-1 !py-0.5 text-[10px] min-h-0 h-auto w-full"
                            >
                              {t("admin.monitoring.common.view")}
                            </Button>
                          </td>
                          {canEditBoards && (
                            <td className="px-0 py-2 text-center align-middle">
                              <div className="flex flex-col items-stretch gap-0.5">
                                <Button
                                  onClick={() => {
                                    setEditingMonitoredBoard(board);
                                    setShowMonitoredBoardForm(true);
                                  }}
                                  variant="ghost"
                                  size="sm"
                                  className="!px-1 !py-0.5 text-[10px] min-h-0 h-auto"
                                >
                                  {t("admin.monitoring.common.edit")}
                                </Button>
                                <Button onClick={() => handleDeleteMonitoredBoard(board.id)} variant="danger" size="sm" className="!px-1 !py-0.5 text-[10px] min-h-0 h-auto">
                                  {t("admin.monitoring.common.delete")}
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                            ))}
                          </Fragment>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            
            {/* 일일 게시글 수 모달 */}
            {dailyCountBoard && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setDailyCountBoard(null)}>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">
                    {t("admin.monitoring.daily.modalTitle", {
                      name: dailyCountBoard.name || dailyCountBoard.label || t("admin.monitoring.daily.fallbackBoardName"),
                    })}
                  </h3>
                  {dailyCountBoard.project?.name ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                      {t("admin.monitoring.daily.projectLabel")}: {dailyCountBoard.project.name}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{t("admin.monitoring.projects.unassigned")}</p>
                  )}
                  <div className="flex flex-wrap items-end gap-3 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                        {t("admin.monitoring.daily.startDate")}
                      </label>
                      <LocalizedDateInput
                        type="date"
                        value={dailyCountStartDate}
                        onChange={(e) => setDailyCountStartDate(e.target.value)}
                        className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                        {t("admin.monitoring.daily.endDate")}
                      </label>
                      <LocalizedDateInput
                        type="date"
                        value={dailyCountEndDate}
                        onChange={(e) => setDailyCountEndDate(e.target.value)}
                        className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={applyDailyCountRange}
                      disabled={loadingDailyCount}
                      variant="primary"
                      size="sm"
                    >
                      {t("admin.monitoring.daily.apply")}
                    </Button>
                    <Button
                      type="button"
                      onClick={loadDailyPostCountFromList}
                      disabled={loadingFromList}
                      variant="outline"
                      size="sm"
                      className="bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
                      title={t("admin.monitoring.daily.fromListTitle")}
                    >
                      {loadingFromList ? t("admin.monitoring.daily.fromListLoading") : t("admin.monitoring.daily.fromList")}
                    </Button>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                    <strong>RawLog</strong>: {t("admin.monitoring.daily.rawLogHint1")}{" "}
                    <strong className="text-slate-600 dark:text-slate-300">
                      {t("admin.monitoring.daily.rawLogHintStrong1")}
                    </strong>
                    {t("admin.monitoring.daily.rawLogHint2")}{" "}
                    <strong className="text-slate-600 dark:text-slate-300">
                      {t("admin.monitoring.daily.rawLogHintStrong2")}
                    </strong>
                    {t("admin.monitoring.daily.rawLogHint3")}
                    <strong> {t("admin.monitoring.daily.issueDateHintStrong")}</strong>
                    {t("admin.monitoring.daily.issueDateHintRest")}
                    <br />
                    <strong>{t("admin.monitoring.daily.fromListStrong")}</strong>: {t("admin.monitoring.daily.fromListHint")}
                    <br />
                    <span className="text-slate-600 dark:text-slate-300">
                      {t("admin.monitoring.daily.cardExchangeHintPrefix")}{" "}
                      <strong>{t("admin.monitoring.daily.cardExchangeHintStrong")}</strong>{" "}
                      {t("admin.monitoring.daily.cardExchangeHintSuffix")}
                    </span>
                  </p>
                  {loadingDailyCount ? (
                    <div className="py-8 text-center text-slate-500 dark:text-slate-400">{t("common.loading", { ns: "translation" })}</div>
                  ) : dailyCountError ? (
                    <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                      <p>{dailyCountError}</p>
                    </div>
                  ) : dailyCountData.length === 0 && dailyCountIssueData.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 dark:text-slate-400 space-y-2">
                      {dailyCountMeta && dailyCountMeta.totalRawLogCount === 0 && dailyCountMeta.lastScanAt && (
                        <p>
                          {t("admin.monitoring.daily.emptyCrawlerRan")}
                          <br />
                          {t("admin.monitoring.daily.emptyCrawlerReasons")}
                        </p>
                      )}
                      {(!dailyCountMeta || dailyCountMeta.totalRawLogCount > 0) && (
                        <p>{t("admin.monitoring.daily.emptyNoData")}</p>
                      )}
                      {dailyCountMeta?.lastScanAt && (
                        <p className="text-xs">
                          {t("admin.monitoring.daily.lastScan")}:{" "}
                          {new Date(dailyCountMeta.lastScanAt).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })}
                          {dailyCountMeta.totalRawLogCount !== undefined &&
                            ` · ${t("admin.monitoring.daily.totalCollected", { n: dailyCountMeta.totalRawLogCount })}`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-y-auto flex-1 min-h-0 space-y-4">
                      {dailyCountData.length > 0 ? (
                      <div>
                        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          {t("admin.monitoring.daily.rawLogTableTitle")}
                        </h4>
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.daily.table.date")}</th>
                              <th className="px-3 py-2 text-right font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.daily.table.count")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {dailyCountData.map((row) => (
                              <tr key={row.date}>
                                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.date}</td>
                                <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{row.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-xs text-slate-400 mt-2">
                          {t("admin.monitoring.daily.total", { n: dailyCountData.reduce((s, r) => s + r.count, 0) })}
                        </p>
                      </div>
                      ) : (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{t("admin.monitoring.daily.rawLogTableEmpty")}</p>
                      )}
                      {dailyCountIssueData.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            {t("admin.monitoring.daily.issueTableTitle")}
                          </h4>
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-700">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.daily.table.date")}</th>
                                <th className="px-3 py-2 text-right font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.daily.table.count")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                              {dailyCountIssueData.map((row) => (
                                <tr key={row.date}>
                                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.date}</td>
                                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{row.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="text-xs text-slate-400 mt-2">
                            {t("admin.monitoring.daily.total", { n: dailyCountIssueData.reduce((s, r) => s + r.count, 0) })}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {dailyCountFromList.length > 0 && (
                    <div className="mt-4 pt-4 border-t dark:border-slate-700">
                      <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t("admin.monitoring.daily.fromListSectionTitle")}
                        {dailyCountFromListTotal != null && (
                          <span className="text-slate-500 dark:text-slate-400 font-normal ml-2">
                            · {t("admin.monitoring.daily.fromListScannedRows", { n: dailyCountFromListTotal })}
                          </span>
                        )}
                      </h4>
                      {(dailyCountStartDate || dailyCountEndDate) && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                          {t("admin.monitoring.daily.fromListDisplayRange", {
                            start: dailyCountStartDate || "…",
                            end: dailyCountEndDate || "…",
                          })}
                        </p>
                      )}
                      {dailyCountFromListFiltered.length === 0 &&
                        dailyCountFromList.length > 0 &&
                        (dailyCountStartDate || dailyCountEndDate) && (
                          <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">{t("admin.monitoring.daily.fromListNoRowsInRange")}</p>
                        )}
                      <div className="overflow-y-auto max-h-48">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 dark:bg-slate-700">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.daily.table.date")}</th>
                              <th className="px-3 py-2 text-right font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.daily.table.count")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {dailyCountFromListFiltered.map((row) => (
                              <tr key={row.date}>
                                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.date}</td>
                                <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{row.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-xs text-slate-400 mt-2">
                          {t("admin.monitoring.daily.total", { n: dailyCountFromListFiltered.reduce((s, r) => s + r.count, 0) })}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 pt-4 border-t dark:border-slate-700 flex justify-end">
                    <Button type="button" onClick={() => setDailyCountBoard(null)} variant="ghost">
                      {t("admin.monitoring.common.close")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* 게시판 추가/수정 폼 */}
            {showMonitoredBoardForm && editingMonitoredBoard && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => {
                setShowMonitoredBoardForm(false);
                setEditingMonitoredBoard(null);
              }}>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-xl font-semibold mb-4 text-slate-800 dark:text-slate-100">
                    {editingMonitoredBoard.id
                      ? t("admin.monitoring.boardForm.editTitle")
                      : t("admin.monitoring.boardForm.addTitle")}
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.boardForm.fields.name")}
                      </label>
                      <input
                        type="text"
                        value={editingMonitoredBoard.name || ''}
                        onChange={(e) =>
                          setEditingMonitoredBoard({ ...editingMonitoredBoard, name: e.target.value })
                        }
                        placeholder={t("admin.monitoring.boardForm.placeholders.name")}
                        className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("admin.monitoring.boardForm.hints.name")}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.boardForm.fields.url")}
                      </label>
                      <input
                        type="text"
                        value={editingMonitoredBoard.url || editingMonitoredBoard.listUrl || ''}
                        onChange={(e) =>
                          setEditingMonitoredBoard({ 
                            ...editingMonitoredBoard, 
                            url: e.target.value,
                            listUrl: e.target.value // 호환성
                          })
                        }
                        placeholder="https://cafe.naver.com/.../menus/0"
                        disabled={!!editingMonitoredBoard.id}
                        className={`w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 ${
                          editingMonitoredBoard.id ? 'bg-slate-100 dark:bg-slate-600 cursor-not-allowed' : ''
                        }`}
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {editingMonitoredBoard.id
                          ? t("admin.monitoring.boardForm.hints.urlLocked")
                          : t("admin.monitoring.boardForm.hints.url")}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.boardForm.fields.crawlerProfile")}
                      </label>
                      <select
                        value={editingMonitoredBoard.cafeGame || defaultCafeGameCode}
                        onChange={(e) =>
                          setEditingMonitoredBoard({ ...editingMonitoredBoard, cafeGame: e.target.value })
                        }
                        className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                      >
                        {crawlerGames.length === 0 ? (
                          <option value={defaultCafeGameCode}>
                            {t("admin.monitoring.boardForm.loadingProfile", { code: defaultCafeGameCode })}
                          </option>
                        ) : (
                          crawlerGames.map((g) => (
                            <option key={g.code} value={g.code}>
                              {g.label}
                            </option>
                          ))
                        )}
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("admin.monitoring.boardForm.hints.crawlerProfilePrefix")}{" "}
                        <span className="font-medium">{t("admin.monitoring.boardForm.hints.crawlerProfileStrong1")}</span>
                        {t("admin.monitoring.boardForm.hints.crawlerProfileMid")}{" "}
                        <span className="font-medium">{t("admin.monitoring.boardForm.hints.crawlerProfileStrong2")}</span>
                        {t("admin.monitoring.boardForm.hints.crawlerProfileSuffix")}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.boardForm.fields.project")}
                      </label>
                      <select
                        value={editingMonitoredBoard.projectId || ''}
                        onChange={(e) =>
                          setEditingMonitoredBoard({ 
                            ...editingMonitoredBoard, 
                            projectId: e.target.value === '' ? null : parseInt(e.target.value, 10)
                          })
                        }
                        className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">{t("admin.monitoring.projects.unassigned")}</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("admin.monitoring.boardForm.hints.project")}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.boardForm.fields.labelOptional")}
                      </label>
                      <input
                        type="text"
                        value={editingMonitoredBoard.label || ''}
                        onChange={(e) =>
                          setEditingMonitoredBoard({ ...editingMonitoredBoard, label: e.target.value })
                        }
                        placeholder={t("admin.monitoring.boardForm.placeholders.label")}
                        className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("admin.monitoring.boardForm.hints.label")}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                        {t("admin.monitoring.boardForm.fields.scanIntervalSeconds")}
                      </label>
                      <input
                        type="number"
                        value={editingMonitoredBoard.checkInterval || editingMonitoredBoard.interval || 60}
                        onChange={(e) => {
                          const value = parseInt(e.target.value) || 60;
                          setEditingMonitoredBoard({
                            ...editingMonitoredBoard,
                            interval: value,
                            checkInterval: value
                          });
                        }}
                        min={30}
                        max={3600}
                        className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("admin.monitoring.boardForm.hints.scanInterval")}
                      </p>
                    </div>
                    {editingMonitoredBoard.id && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editingMonitoredBoard.isActive !== false && editingMonitoredBoard.enabled !== false}
                          onChange={(e) =>
                            setEditingMonitoredBoard({ 
                              ...editingMonitoredBoard, 
                              enabled: e.target.checked,
                              isActive: e.target.checked
                            })
                          }
                          className="w-4 h-4"
                        />
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.boardForm.fields.enabled")}</label>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <Button onClick={handleSaveMonitoredBoard} variant="primary" className="flex-1">
                        {t("admin.monitoring.common.save")}
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingMonitoredBoard(null);
                          setShowMonitoredBoardForm(false);
                        }}
                        variant="ghost"
                        className="flex-1"
                      >
                        {t("admin.monitoring.common.cancel")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 키워드 관리 */}
        {activeTab === 'keywords' && (
            <div className="ui-card ui-card-pad">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{t("admin.monitoring.keywords.title")}</h2>
              {(user?.role === 'ADMIN' || user?.role === 'LEAD') && (
                <div className="flex gap-2">
                  <select
                    value={newKeyword.type}
                    onChange={(e) => setNewKeyword({ ...newKeyword, type: e.target.value as any })}
                    className="px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    <option value="naver">{t("admin.monitoring.keywords.type.naver")}</option>
                    <option value="discord">{t("admin.monitoring.keywords.type.discord")}</option>
                    <option value="system">{t("admin.monitoring.keywords.type.system")}</option>
                  </select>
                  <input
                    type="text"
                    value={newKeyword.word}
                    onChange={(e) => setNewKeyword({ ...newKeyword, word: e.target.value })}
                    placeholder={t("admin.monitoring.keywords.placeholder")}
                    className="px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  />
                  <Button onClick={handleAddKeyword} variant="primary" size="sm">
                    {t("admin.monitoring.keywords.add")}
                  </Button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-slate-50 dark:bg-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.keywords.table.type")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.keywords.table.word")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.keywords.table.status")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.keywords.table.createdAt")}</th>
                    {(user?.role === 'ADMIN' || user?.role === 'LEAD') && (
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-300">{t("admin.monitoring.keywords.table.actions")}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {keywords.map((keyword) => (
                    <tr key={keyword.id}>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs">
                          {keyword.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                        {keyword.word}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {keyword.enabled ? (
                          <span className="text-green-600 dark:text-green-400">{t("admin.monitoring.common.active")}</span>
                        ) : (
                          <span className="text-slate-400">{t("admin.monitoring.common.inactive")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                        {new Date(keyword.createdAt).toLocaleDateString(dateLocale)}
                      </td>
                      {(user?.role === 'ADMIN' || user?.role === 'LEAD') && (
                        <td className="px-4 py-3 text-sm">
                          <Button onClick={() => handleDeleteKeyword(keyword.id)} variant="danger" size="sm">
                            {t("admin.monitoring.common.delete")}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {keywords.length === 0 && (
                <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                  {t("admin.monitoring.keywords.empty")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 최근 로그 */}
        {activeTab === 'logs' && (
          <div className="ui-card ui-card-pad">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{t("admin.monitoring.logs.title")}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t("admin.monitoring.logs.subtitle")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={logsDiscourseOnly}
                    onChange={(e) => {
                      setLogsDiscourseOnly(e.target.checked);
                      setLogsSelectedTag(null);
                    }}
                    className="w-4 h-4"
                  />
                  Discourse만
                </label>
                {logsSelectedTag && (
                  <button
                    type="button"
                    onClick={() => setLogsSelectedTag(null)}
                    className="px-2 py-1 rounded-full text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                    title="태그 필터 해제"
                  >
                    #{logsSelectedTag} ×
                  </button>
                )}
                <Button onClick={loadLogs} disabled={loading} variant="primary" size="sm">
                  {loading ? t("common.loading", { ns: "translation" }) : t("admin.monitoring.logs.refresh")}
                </Button>
              </div>
            </div>
            {loading ? (
              <div className="text-center text-slate-500 dark:text-slate-400 py-8">{t("common.loading", { ns: "translation" })}</div>
            ) : (
              <div className="space-y-3">
                <div className="hidden md:grid grid-cols-[minmax(0,1fr)_80px_80px_90px_140px_120px] gap-3 px-3 text-xs text-slate-500 dark:text-slate-400">
                  <div className="py-1">Topic</div>
                  <div className="py-1 text-right">Replies</div>
                  <div className="py-1 text-right">Likes</div>
                  <div className="py-1 text-right">Views</div>
                  <div className="py-1 text-right">Activity</div>
                  <div className="py-1 text-right">Preview</div>
                </div>

                {filteredLogs.map((log) => {
                  const meta = safeParseMetadata(log.metadata);
                  let title: string | null = meta.title || null;
                  const requiresLogin =
                    meta.requiresLogin === true || meta.requiresLogin === ("true" as any) || (meta.requiresLogin as any) === 1;
                  const hasKeywordMatch =
                    meta.hasKeywordMatch === true || meta.hasKeywordMatch === ("true" as any) || (meta.hasKeywordMatch as any) === 1;

                  if (!title && log.content) {
                    const firstLine = log.content.split("\n")[0];
                    title = firstLine.trim() || null;
                  }
                  if (!title && requiresLogin && log.metadata) title = meta.title || null;

                  const displayProject = log.projectName || log.source;
                  const isDiscourse = log.source === "discourse";

                  const discourseTags = Array.isArray(meta.discourseTags) ? meta.discourseTags.filter(Boolean) : [];
                  const discourseBadges: { label: string; kind: "slate" | "indigo" | "emerald" | "amber" | "rose" }[] = [];
                  if (meta.discourseCategoryName) discourseBadges.push({ label: meta.discourseCategoryName, kind: "indigo" });
                  if (meta.closed) discourseBadges.push({ label: "closed", kind: "rose" });
                  if (meta.archived) discourseBadges.push({ label: "archived", kind: "slate" });
                  if (meta.pinned) discourseBadges.push({ label: "pinned", kind: "emerald" });
                  for (const tg of discourseTags.slice(0, 6)) discourseBadges.push({ label: `#${tg}`, kind: "slate" });

                  const activityAt = meta.discourseLastPostedAt || meta.discourseBumpedAt || log.createdAt;
                  const previewUrl = meta.screenshotPath
                    ? `/uploads/${meta.screenshotPath}`
                    : meta.discourseImageUrl || null;

                  const badgeCls = (kind: string) =>
                    kind === "indigo"
                      ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : kind === "emerald"
                        ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                        : kind === "amber"
                          ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                          : kind === "rose"
                            ? "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200";

                  return (
                    <div
                      key={log.id}
                      className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_80px_80px_90px_140px_120px] gap-3 items-start rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex-shrink-0">
                            {displayProject}
                          </span>
                          {log.author && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {log.author}
                            </span>
                          )}
                          {requiresLogin && (
                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded-full text-[11px] whitespace-nowrap">
                              {t("admin.monitoring.logs.badge.loginRequired")}
                            </span>
                          )}
                          {hasKeywordMatch && (
                            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full text-[11px] whitespace-nowrap">
                              {t("admin.monitoring.logs.badge.keywordPost")}
                            </span>
                          )}
                          {isDiscourse && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full text-[11px] whitespace-nowrap">
                              Discourse
                            </span>
                          )}
                        </div>

                        <div className="mt-1 min-w-0">
                          {title ? (
                            meta.url ? (
                              <a
                                href={meta.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block font-medium text-slate-900 dark:text-slate-100 truncate hover:underline"
                                title={title}
                              >
                                {title}
                              </a>
                            ) : (
                              <div className="font-medium text-slate-900 dark:text-slate-100 truncate" title={title}>
                                {title}
                              </div>
                            )
                          ) : (
                            <div className="text-slate-400 italic">{t("admin.monitoring.logs.noTitle")}</div>
                          )}
                        </div>

                        {isDiscourse && discourseBadges.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {discourseBadges.map((b, idx) => (
                              <span
                                key={`${b.label}-${idx}`}
                                className={cn("px-2 py-0.5 rounded-full text-[11px]", badgeCls(b.kind))}
                                onClick={() => {
                                  if (b.label.startsWith("#")) {
                                    setLogsSelectedTag(b.label.slice(1));
                                    setLogsDiscourseOnly(true);
                                  }
                                }}
                                role={b.label.startsWith("#") ? "button" : undefined}
                                title={b.label.startsWith("#") ? "태그로 필터" : undefined}
                                style={b.label.startsWith("#") ? { cursor: "pointer" } : undefined}
                              >
                                {b.label}
                              </span>
                            ))}
                          </div>
                        )}

                        {isDiscourse && meta.discourseExcerpt && (
                          <div className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                            {meta.discourseExcerpt}
                          </div>
                        )}

                        {!isDiscourse && (
                          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            {log.isProcessed ? (
                              <span className="text-green-600 dark:text-green-400">{t("admin.monitoring.logs.status.processed")}</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">{t("admin.monitoring.logs.status.pending")}</span>
                            )}
                            <span className="ml-2">
                              {new Date(log.createdAt).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="hidden md:block text-right tabular-nums text-sm text-slate-700 dark:text-slate-200">
                        {typeof meta.discourseReplyCount === "number" ? meta.discourseReplyCount : "—"}
                      </div>
                      <div className="hidden md:block text-right tabular-nums text-sm text-slate-700 dark:text-slate-200">
                        {typeof meta.discourseLikeCount === "number" ? meta.discourseLikeCount : "—"}
                      </div>
                      <div className="hidden md:block text-right tabular-nums text-sm text-slate-700 dark:text-slate-200">
                        {typeof meta.discourseViews === "number" ? meta.discourseViews : "—"}
                      </div>
                      <div className="hidden md:block text-right text-sm text-slate-600 dark:text-slate-300">
                        {activityAt
                          ? new Date(activityAt).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })
                          : "—"}
                      </div>

                      <div className="hidden md:flex justify-end">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt="preview"
                            className="w-[112px] h-[72px] object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => window.open(previewUrl, "_blank")}
                          />
                        ) : (
                          <div className="w-[112px] h-[72px] rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-[11px] text-slate-400 flex items-center justify-center">
                            no preview
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredLogs.length === 0 && (
                  <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                    {t("admin.monitoring.logs.empty")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 설정 */}
        {activeTab === 'settings' && (user?.role === 'ADMIN' || user?.role === 'LEAD') && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 p-6">
            <h2 className="text-xl font-semibold mb-6 text-slate-800 dark:text-slate-100">
              {t("admin.monitoring.settings.title")}
            </h2>

            <div className="mb-8 p-4 border dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
                  {t("admin.monitoring.settings.naverAuth")}
                </h3>
                {cookieStatus === "set" && (
                  <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-full">
                    {t("admin.monitoring.settings.cookieSet")}
                  </span>
                )}
                {cookieStatus === "not-set" && (
                  <span className="px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 text-xs rounded-full">
                    {t("admin.monitoring.settings.cookieNotSet")}
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                    {t("admin.monitoring.settings.cookieLabel")}
                  </label>
                  <textarea
                    value={configs.naverCafeCookie}
                    onChange={(e) => setConfigs((prev) => ({ ...prev, naverCafeCookie: e.target.value }))}
                    placeholder={t("admin.monitoring.settings.cookiePlaceholder")}
                    rows={3}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono text-sm"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {t("admin.monitoring.settings.cookieHint")}
                  </p>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
                    📋 {t("admin.monitoring.settings.copyGuideTitle")}
                  </p>
                  <ol className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
                    <li>{t("admin.monitoring.settings.copyGuide1")}</li>
                    <li>{t("admin.monitoring.settings.copyGuide2")}</li>
                    <li>{t("admin.monitoring.settings.copyGuide3")}</li>
                    <li>{t("admin.monitoring.settings.copyGuide4")}</li>
                  </ol>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    ⚠️ <strong>{t("admin.monitoring.settings.caution")}</strong>{" "}
                    {t("admin.monitoring.settings.cookieWarning")}
                  </p>
                </div>

                <Button
                  onClick={() =>
                    handleSaveConfig(
                      "naverCafeCookie",
                      configs.naverCafeCookie,
                      t("admin.monitoring.settings.saveCookieDesc")
                    )
                  }
                  variant="primary"
                  className="w-full"
                >
                  {t("admin.monitoring.settings.saveCookie")}
                </Button>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
                {t("admin.monitoring.settings.otherTitle")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                    {t("admin.monitoring.settings.excludedBoardsLabel")}
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                    {t("admin.monitoring.settings.excludedBoardsHint")}
                  </p>
                  <textarea
                    value={configs.excludedBoards}
                    onChange={(e) => setConfigs({ ...configs, excludedBoards: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-mono"
                    placeholder={t("admin.monitoring.settings.excludedBoardsPlaceholder")}
                  />
                  <div className="flex justify-end mt-2">
                    <Button
                      onClick={() => {
                        const names = configs.excludedBoards
                          .split("\n")
                          .map((name) => name.trim())
                          .filter((name) => name.length > 0);
                        const value = JSON.stringify(names);
                        handleSaveConfig(
                          "naver.excludedBoards",
                          value,
                          t("admin.monitoring.settings.excludedBoardsSaveDesc")
                        );
                        loadConfigs();
                      }}
                      variant="primary"
                      size="sm"
                    >
                      {t("admin.monitoring.settings.save")}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                    {t("admin.monitoring.settings.clanBoardIdsLabel")}
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                    {t("admin.monitoring.settings.clanBoardIdsHint")}
                  </p>
                  <input
                    type="text"
                    value={configs.clanBoardIds}
                    onChange={(e) => setConfigs({ ...configs, clanBoardIds: e.target.value })}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-mono"
                    placeholder={t("admin.monitoring.settings.clanBoardIdsPlaceholder")}
                  />
                  <div className="flex justify-end mt-2">
                    <Button
                      onClick={() => {
                        handleSaveConfig(
                          "naver.clanBoardIds",
                          configs.clanBoardIds.trim(),
                          t("admin.monitoring.settings.clanBoardIdsSaveDesc")
                        );
                        loadConfigs();
                      }}
                      variant="primary"
                      size="sm"
                    >
                      {t("admin.monitoring.settings.save")}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                    {t("admin.monitoring.settings.scanIntervalLabel")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={configs.scanInterval}
                      onChange={(e) => setConfigs({ ...configs, scanInterval: e.target.value })}
                      className="px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    />
                    <Button
                      onClick={() => {
                        handleSaveConfig("crawler.interval", configs.scanInterval);
                        loadConfigs();
                      }}
                      variant="primary"
                      size="sm"
                    >
                      {t("admin.monitoring.settings.save")}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                    {t("admin.monitoring.settings.cooldownLabel")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={configs.cooldown}
                      onChange={(e) => setConfigs({ ...configs, cooldown: e.target.value })}
                      className="px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    />
                    <Button
                      onClick={() => {
                        handleSaveConfig("alert.cooldown", configs.cooldown);
                        loadConfigs();
                      }}
                      variant="primary"
                      size="sm"
                    >
                      {t("admin.monitoring.settings.save")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

