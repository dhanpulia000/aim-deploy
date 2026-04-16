import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth/AuthContext";
import { useIssues } from "./contexts/IssueContext";
import ProjectSelector from "./components/ProjectSelector";
import IssueDetailPanel from "./components/IssueDetailPanel";
import { isMobileDevice } from "./utils/device";
import { useRealtime } from "./hooks/useRealtime";
import { logger } from "./utils/logger";
import {
  notifyNewIssue,
  notifySlaViolation,
  notifyIssueUpdate,
  requestNotificationPermission,
  getNotificationPermission,
} from "./utils/desktopNotifications";
import ManualIngestModal from "./components/ManualIngestModal";
import { NoticeScreenshotImage } from "./components/NoticeScreenshotImage";
import { ProcessingProgressModal } from "./components/ProcessingProgressModal";
import { WebSocketStatusBadge } from "./components/WebSocketStatusBadge";
import { NoticeEditor, type NoticeFormValue } from "./components/NoticeEditor";
import { ViewRouter } from "./components/ViewRouter";
import { AgentStatusSection } from "./components/AgentStatusSection";
import { MetricsCards } from "./components/MetricsCards";
import { TicketCardItem } from "./components/TicketCardItem";
import { Button } from "./components/ui/Button";
import { AiBotIcon } from "./components/icons/AiAssistantIcon";

import type {
  AgentStatus,
  Ticket,
  TicketSeverity,
  IssueComment,
  IssueWorkflowStatus,
  CustomerFeedbackNotice,
} from "./types";
import type { RealtimeEventHandlers } from "./types/realtime";
import {
  loadFiltersFromStorage,
  saveFiltersToStorage,
  initialSearchQueryTrimmed,
} from "./utils/issueFilterStorage";
import { sortFeedbackNoticesEndedLast } from "./utils/noticeSort";
import { useCrawlerGames } from "./hooks/useCrawlerGames";
import { ticketCafeGameFields } from "./utils/cafeGameDisplay";
import { LocalizedDateInput } from "./components/LocalizedDateInput";

export default function App() {
  const {
    tickets,
    agents,
    projectAgents,
    filter,
    setTickets,
    setAgents,
    setProjectAgents,
    setFilter,
    filteredTickets,
  } = useIssues();
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [issueComments, setIssueComments] = useState<IssueComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentInput, setCommentInput] = useState<string>("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [feedbackNotices, setFeedbackNotices] = useState<
    CustomerFeedbackNotice[]
  >([]);
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [showNoticeForm, setShowNoticeForm] = useState(false);
  const [submittingNotice, setSubmittingNotice] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    new Set(),
  );
  /** 검색·필터 패널 기본 접힘 (펼치기는 사용자가 헤더 클릭) */
  const [isTopSectionExpanded, setIsTopSectionExpanded] = useState(false);
  const [isHighPriorityExpanded, setIsHighPriorityExpanded] = useState(false); // 중요 이슈 섹션 접기/펼치기 (기본: 접힘)
  const [editingNotice, setEditingNotice] =
    useState<CustomerFeedbackNotice | null>(null);
  const [processingProgress, setProcessingProgress] = useState<{
    current: number;
    total: number;
    isProcessing: boolean;
  } | null>(null);
  const [availableGames, setAvailableGames] = useState<string[]>([]); // 사용 가능한 게임 목록
  const [selectedNotice, setSelectedNotice] =
    useState<CustomerFeedbackNotice | null>(null); // 팝업에 표시할 공지
  const [showManualIngestModal, setShowManualIngestModal] = useState(false); // 수동 수집 모달
  const [searchQuery, setSearchQuery] = useState(() =>
    initialSearchQueryTrimmed(),
  ); // 검색어 (localStorage 복원, trim)
  const [triggeringSlackNotice, setTriggeringSlackNotice] = useState(false); // 슬랙 공지 수집 트리거 상태
  const [slackUsers, setSlackUsers] = useState<
    Array<{ id: string; name: string; displayName?: string }>
  >([]);
  const [selectedSlackNoticeUserIds, setSelectedSlackNoticeUserIds] = useState<
    string[]
  >([]);
  const [slackUsersLoadError, setSlackUsersLoadError] = useState<string | null>(
    null,
  );
  const [manualSlackNoticeUserIds, setManualSlackNoticeUserIds] =
    useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(() =>
    initialSearchQueryTrimmed(),
  ); // debounce된 검색어(초기값 동기화)
  const [dateFilter, setDateFilter] = useState<{
    startDate?: string;
    endDate?: string;
  }>(() => loadFiltersFromStorage()?.dateFilter ?? {}); // 날짜 필터 (localStorage 복원)
  const [showCompletedIssues, setShowCompletedIssues] = useState(() => {
    const s = loadFiltersFromStorage();
    return s?.showCompletedIssues ?? true;
  }); // 완료된 이슈 표시 여부 (localStorage 복원)
  const [currentView, setCurrentView] = useState<
    | "main"
    | "assistant"
    | "workChecklist"
    | "handover"
    | "calendar"
    | "workGuideManagement"
    | "workChecklistManagement"
    | "stepFloatingManagement"
    | "workNotificationManagement"
    | "commentWatchManagement"
    | "notices"
    | "notificationSettings"
    | "forumMonitoring"
    | "inzoiStandaloneAlerts"
  >("main"); // 현재 뷰
  // 무한 스크롤 상태
  const [hasMoreIssues, setHasMoreIssues] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalIssuesCount, setTotalIssuesCount] = useState(0);
  const [serverGameCounts, setServerGameCounts] = useState<Record<
    string,
    { total: number; sev1: number; open: number }
  > | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsLoadError, setAgentsLoadError] = useState<string | null>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null); // 무한 스크롤 트리거 요소(페이지 하단, 전역)
  const noticeEditorRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** WebSocket 오류 로그/알림을 한 세션에 한 번만 하기 위한 플래그 */
  const wsErrorLoggedRef = useRef(false);
  const { user, logout, selectedProjectId, projects, token } = useAuth();
  const { lookups: crawlerLookups } = useCrawlerGames(
    token,
    currentView === "main",
  );
  const { t, i18n } = useTranslation("app");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";

  const getKstTodayYmd = useCallback(() => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(kst.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  // 상단 "메인화면" 클릭 시(이미 경로가 "/"일 때) 앱 내부 뷰를 메인으로 복귀
  useEffect(() => {
    const handleGoToMain = () => setCurrentView("main");
    window.addEventListener("app:goToMainView", handleGoToMain);
    return () => window.removeEventListener("app:goToMainView", handleGoToMain);
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const authHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  // authHeaders를 HeadersInit로 변환 (빈 객체일 때는 undefined)
  const authHeadersForFetch = useMemo<HeadersInit | undefined>(() => {
    return Object.keys(authHeaders).length > 0 ? authHeaders : undefined;
  }, [authHeaders]);

  // 검색어 debounce 처리 (0.5초 후 검색 실행)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 검색/필터 상태 localStorage 저장 (새로고침·페이지 이동 후 유지). 공백만 있는 검색어는 저장 시 제거
  useEffect(() => {
    saveFiltersToStorage({
      searchQuery: searchQuery.trim(),
      dateFilter,
      showCompletedIssues,
    });
  }, [searchQuery, dateFilter, showCompletedIssues]);

  // Context에서 제공되는 값들은 이미 useMemo로 최적화됨
  const projectQuery = selectedProjectId
    ? `projectId=${selectedProjectId}`
    : "";
  const authHeadersOrUndefined = useMemo<HeadersInit | undefined>(
    () => (Object.keys(authHeaders).length ? authHeaders : undefined),
    [authHeaders],
  );
  const withProjectParam = (path: string) =>
    projectQuery ? `${path}?${projectQuery}` : path;

  const fetchIssueComments = useCallback(
    async (issueId: string) => {
      if (!token) return;
      setCommentsLoading(true);
      try {
        const res = await fetch(
          withProjectParam(`/api/issues/${issueId}/comments`),
          {
            headers: authHeadersOrUndefined,
          },
        );
        if (!res.ok) {
          throw new Error("Failed to load comments");
        }
        const body = await res.json();
        const rawComments = Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body)
            ? body
            : [];
        const formatted: IssueComment[] = rawComments.map((comment: any) => ({
          id: comment.id,
          issueId: issueId,
          body: comment.body,
          createdAt: comment.createdAt,
          authorId: comment.author?.id || comment.authorId || null,
          authorName: comment.author?.name || comment.authorName || null,
        }));
        setIssueComments(formatted);
      } catch (error) {
        logger.error("Failed to fetch issue comments", { error });
        setIssueComments([]);
      } finally {
        setCommentsLoading(false);
      }
    },
    [token, authHeadersOrUndefined],
  );

  const handleSelectTicket = useCallback(
    async (ticket: Ticket) => {
      logger.debug("handleSelectTicket called", { ticketId: ticket.id });
      // 모바일 최적화: ticket 객체를 안정적으로 저장 (이전 ticket과 issueId가 같으면 업데이트만)
      setSelectedTicket((prev) => {
        if (prev && prev.issueId === ticket.issueId) {
          // 같은 이슈면 병합 (불필요한 리렌더링 방지)
          return { ...prev, ...ticket };
        }
        return ticket;
      });
      setCommentInput("");
      if (ticket.issueId) {
        fetchIssueComments(ticket.issueId);
      } else {
        setIssueComments([]);
      }

      // 이슈 상세 패널이 열리도록 스크롤 (모바일 최적화)
      if (isMobileDevice()) {
        setTimeout(() => {
          const panel = document.getElementById("issue-detail-panel");
          if (panel) {
            panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }, 100);
      }

      // 담당 에이전트가 비어있고, 사용자 이름과 일치하는 에이전트가 있으면 자동으로 지정
      if (
        !ticket.assignedAgentId &&
        user?.name &&
        projectAgents.length > 0 &&
        ticket.issueId &&
        token
      ) {
        const matchingAgent = projectAgents.find(
          (agent) => agent.name === user.name,
        );
        if (matchingAgent) {
          try {
            const res = await fetch(
              withProjectParam(`/api/issues/${ticket.issueId}/assign`),
              {
                method: "POST",
                headers: {
                  ...authHeaders,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ agentId: matchingAgent.id }),
              },
            );
            if (res.ok) {
              setTickets((prev) =>
                prev.map((t) =>
                  t.id === ticket.id
                    ? {
                        ...t,
                        assignedAgentId: matchingAgent.id,
                        assignedAgentName: matchingAgent.name,
                      }
                    : t,
                ),
              );
              setSelectedTicket((prev) => {
                if (!prev || prev.id !== ticket.id) return prev;
                return {
                  ...prev,
                  assignedAgentId: matchingAgent.id,
                  assignedAgentName: matchingAgent.name,
                };
              });
            }
          } catch (error) {
            logger.error("Failed to auto-assign agent", { error });
          }
        }
      }
    },
    [user?.name, projectAgents, token, authHeaders, fetchIssueComments],
  );

  const handleAssignAgent = useCallback(
    async (agentId: string) => {
      if (!selectedTicket || !selectedTicket.issueId || !token) return;
      try {
        // 빈 문자열이면 null로 변환 (담당자 해제)
        const normalizedAgentId = agentId === "" ? null : agentId || null;

        const res = await fetch(
          withProjectParam(`/api/issues/${selectedTicket.issueId}/assign`),
          {
            method: "POST",
            headers: {
              ...(authHeadersForFetch as Record<string, string>),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ agentId: normalizedAgentId }),
          },
        );

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || "Failed to assign agent");
        }

        const result = await res.json();
        const updatedIssue = result.data;

        // 응답에서 업데이트된 정보 사용
        const assignedAgent = normalizedAgentId
          ? projectAgents.find((agent) => agent.id === normalizedAgentId) ||
            null
          : null;

        setTickets((prev) =>
          prev.map((ticket) =>
            ticket.id === selectedTicket.id
              ? {
                  ...ticket,
                  assignedAgentId: normalizedAgentId || undefined,
                  assignedAgentName:
                    updatedIssue?.assignedAgentName ||
                    assignedAgent?.name ||
                    null,
                }
              : ticket,
          ),
        );
        setSelectedTicket((prev) =>
          prev
            ? {
                ...prev,
                assignedAgentId: normalizedAgentId || undefined,
                assignedAgentName:
                  updatedIssue?.assignedAgentName ||
                  assignedAgent?.name ||
                  null,
              }
            : prev,
        );
      } catch (error) {
        logger.error("Failed to assign agent", { error, agentId });
        alert(
          t("alerts.assignFailed", {
            message: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
    },
    [selectedTicket, token, authHeadersForFetch, projectAgents, t],
  );

  const handleStatusUpdate = useCallback(
    async (status: IssueWorkflowStatus) => {
      if (!selectedTicket || !selectedTicket.issueId || !token) return;
      try {
        const res = await fetch(
          withProjectParam(`/api/issues/${selectedTicket.issueId}/status`),
          {
            method: "POST",
            headers: {
              ...(authHeadersForFetch as Record<string, string>),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status }),
          },
        );
        if (!res.ok) {
          throw new Error("Failed to update issue status");
        }
        setTickets((prev) =>
          prev.map((ticket) =>
            ticket.id === selectedTicket.id ? { ...ticket, status } : ticket,
          ),
        );
        setSelectedTicket((prev) => (prev ? { ...prev, status } : prev));
      } catch (error) {
        logger.error("Failed to update status", { error });
      }
    },
    [selectedTicket, token, authHeadersForFetch],
  );

  const handleCommentSubmit = async () => {
    if (
      !selectedTicket ||
      !selectedTicket.issueId ||
      !token ||
      !commentInput.trim()
    )
      return;
    try {
      setCommentSubmitting(true);
      const res = await fetch(
        withProjectParam(`/api/issues/${selectedTicket.issueId}/comments`),
        {
          method: "POST",
          headers: {
            ...(authHeadersForFetch as Record<string, string>),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body: commentInput.trim() }),
        },
      );
      if (!res.ok) {
        throw new Error("Failed to add comment");
      }
      const body = await res.json();
      const comment = body?.data || body;
      const formatted: IssueComment = {
        id: comment.id,
        issueId: selectedTicket.issueId,
        body: comment.body,
        createdAt: comment.createdAt,
        authorId: comment.author?.id || comment.authorId || null,
        authorName: comment.author?.name || comment.authorName || null,
      };
      setIssueComments((prev) => [...prev, formatted]);
      setCommentInput("");
    } catch (error) {
      logger.error("Failed to submit comment", { error });
    } finally {
      setCommentSubmitting(false);
    }
  };

  const toggleTicketSelection = (ticketId: string) => {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedTicketIds(new Set());

  const closeDetailPanel = useCallback(() => {
    setSelectedTicket(null);
    setIssueComments([]);
    setCommentInput("");
  }, []);

  // 공지사항 로드 (silent: true면 백그라운드 갱신으로 로딩 UI 없이 갱신 → 깜박임 방지)
  const fetchFeedbackNotices = async (options?: { silent?: boolean }) => {
    if (!token) return;
    const silent = options?.silent === true;
    if (!silent) setLoadingNotices(true);
    try {
      const url = selectedProjectId
        ? `/api/feedback-notices?projectId=${selectedProjectId}`
        : "/api/feedback-notices";
      const res = await fetch(url, {
        headers: authHeadersForFetch,
      });
      if (!res.ok) {
        throw new Error("Failed to load notices");
      }
      const body = await res.json();
      const notices = Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body)
          ? body
          : [];
      setFeedbackNotices(notices);
    } catch (error) {
      logger.error("Failed to fetch feedback notices", { error });
      if (!silent) setFeedbackNotices([]);
    } finally {
      if (!silent) setLoadingNotices(false);
    }
  };

  // 공지사항 열람 기록
  const markNoticeAsRead = async (noticeId: number) => {
    if (!token) return;
    try {
      // 현재 사용자 이름으로 Agent 찾기
      const currentAgent = projectAgents.find(
        (agent) => agent.name === user?.name,
      );
      if (!currentAgent) {
        logger.warn("Current user agent not found");
        return;
      }

      const res = await fetch(`/api/feedback-notices/${noticeId}/read`, {
        method: "POST",
        headers: {
          ...(authHeadersForFetch as Record<string, string>),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: currentAgent.id }),
      });
      if (res.ok) {
        // 공지 목록 새로고침
        await fetchFeedbackNotices();
        // 선택된 공지도 새로고침 (unreadAgents 정보 보존)
        if (selectedNotice?.id === noticeId) {
          const detailRes = await fetch(
            `/api/feedback-notices/${noticeId}?projectId=${selectedProjectId}`,
            {
              headers: authHeaders,
            },
          );
          if (detailRes.ok) {
            const detailBody = await detailRes.json();
            const notice = Array.isArray(detailBody?.data)
              ? detailBody.data[0]
              : detailBody?.data || detailBody;
            // 기존 unreadAgents와 readAgents 정보 보존 (API 응답에 없을 경우를 대비)
            setSelectedNotice({
              ...notice,
              unreadAgents: notice.unreadAgents || selectedNotice.unreadAgents,
              readAgents: notice.readAgents || selectedNotice.readAgents,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Failed to mark notice as read", { error });
    }
  };

  // 슬랙 공지 수집 트리거
  const handleTriggerSlackNoticeCollection = async () => {
    if (!token) {
      return;
    }

    setTriggeringSlackNotice(true);
    try {
      const res = await fetch("/api/monitoring/trigger-slack-notice", {
        method: "POST",
        headers: {
          ...(authHeadersForFetch as Record<string, string>),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // 관리자 화면에서 선택한 Slack 계정(작성자) 필터를 함께 전달
          userIds: selectedSlackNoticeUserIds,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || t("errors.slackTrigger"));
      }

      const body = await res.json();
      logger.info("Slack notice collection triggered", { data: body.data });

      // 성공 메시지 표시 (간단한 알림)
      alert(t("alerts.slackTriggerOk"));

      // 수집 후 공지 목록 새로고침 (약간의 지연 후)
      setTimeout(() => {
        fetchFeedbackNotices();
      }, 5000); // 5초 후 새로고침
    } catch (error) {
      logger.error("Failed to trigger Slack notice collection", { error });
      alert(
        error instanceof Error
          ? error.message
          : t("alerts.slackTriggerUnknown"),
      );
    } finally {
      setTriggeringSlackNotice(false);
    }
  };

  // (Admin/Lead) Slack 사용자 목록/현재 선택된 공지 수집 계정 로드 (메인 보드에서만 — 보조 화면에서 /api 실패 로그·콘솔 노이즈 방지)
  useEffect(() => {
    if (currentView !== "main") return;
    const canConfigureSlackNotice =
      user?.role === "ADMIN" ||
      user?.role === "LEAD" ||
      user?.role === "SUPERADMIN";
    if (!token || !canConfigureSlackNotice) return;

    (async () => {
      try {
        const [usersRes, cfgRes] = await Promise.all([
          fetch("/api/monitoring/slack/users", { headers: authHeaders }),
          fetch("/api/monitoring/config/slack.notice.userIds", {
            headers: authHeaders,
          }),
        ]);

        if (usersRes.ok) {
          const body = await usersRes.json();
          if (body?.success) {
            setSlackUsers(body.data || []);
            setSlackUsersLoadError(null);
          }
        } else {
          const errBody = await usersRes.json().catch(() => ({}));
          setSlackUsersLoadError(
            errBody?.message || errBody?.error || t("errors.slackUsersGeneric"),
          );
        }

        if (cfgRes.ok) {
          const cfgBody = await cfgRes.json();
          const value = cfgBody?.data?.value;
          if (value) {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed)) {
                setSelectedSlackNoticeUserIds(
                  parsed.map((v: any) => String(v)),
                );
                setManualSlackNoticeUserIds(
                  parsed.map((v: any) => String(v)).join(","),
                );
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (e) {
        setSlackUsersLoadError(t("errors.slackUsersHint"));
      }
    })();
  }, [token, user?.role, t, authHeaders, currentView]);

  // 공지사항 상세 조회
  const handleNoticeClick = async (notice: CustomerFeedbackNotice) => {
    // 열람 기록 먼저 처리
    await markNoticeAsRead(notice.id);

    // 상세 정보 로드 (unreadAgents 포함)
    if (token) {
      try {
        const url = selectedProjectId
          ? `/api/feedback-notices/${notice.id}?projectId=${selectedProjectId}`
          : `/api/feedback-notices/${notice.id}`;
        const res = await fetch(url, {
          headers: authHeaders,
        });
        if (res.ok) {
          const body = await res.json();
          const noticeDetail = Array.isArray(body?.data)
            ? body.data[0]
            : body?.data || body;
          // 상세 정보에 기존 notice 정보 병합 (unreadAgents가 없을 경우를 대비)
          setSelectedNotice({
            ...notice,
            ...noticeDetail,
            // unreadAgents와 readAgents는 상세 정보에서 가져온 것을 우선 사용
            unreadAgents: noticeDetail.unreadAgents || notice.unreadAgents,
            readAgents: noticeDetail.readAgents || notice.readAgents,
          });
        } else {
          // API 호출 실패 시 기존 notice 정보 사용
          setSelectedNotice(notice);
        }
      } catch (error) {
        logger.error("Failed to fetch notice detail", { error });
        // 에러 발생 시 기존 notice 정보 사용
        setSelectedNotice(notice);
      }
    } else {
      // 토큰이 없으면 기존 notice 정보만 사용
      setSelectedNotice(notice);
    }
  };

  const closeNoticeEditor = () => {
    setShowNoticeForm(false);
    setEditingNotice(null);
  };

  // 공지사항 생성/수정
  const handleSaveNotice = async (form: NoticeFormValue) => {
    if (
      !token ||
      !form.gameName ||
      !form.managerName ||
      !form.category ||
      !form.content ||
      !form.noticeDate
    ) {
      alert(t("alerts.noticeFields"));
      return;
    }
    setSubmittingNotice(true);
    try {
      const isEditing = !!editingNotice;
      const endpoint = isEditing
        ? `/api/feedback-notices/${editingNotice?.id}`
        : "/api/feedback-notices";
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: {
          ...(authHeadersForFetch as Record<string, string>),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(
          error.message ||
            (isEditing ? "Failed to update notice" : "Failed to create notice"),
        );
      }
      await fetchFeedbackNotices();
      closeNoticeEditor();
    } catch (error: any) {
      logger.error("Failed to save notice", { error });
      alert(error.message || t("alerts.noticeSaveFailedShort"));
    } finally {
      setSubmittingNotice(false);
    }
  };

  const handleEditNotice = (notice: CustomerFeedbackNotice) => {
    setEditingNotice(notice);
    setShowNoticeForm(true);
    requestAnimationFrame(() => {
      noticeEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const resetNoticeForm = closeNoticeEditor;

  const handleEndNotice = async (noticeId: number) => {
    if (!token) return;
    if (!confirm(t("alerts.noticeEndConfirm"))) return;
    try {
      const res = await fetch(`/api/feedback-notices/${noticeId}/end`, {
        method: "POST",
        headers: authHeadersForFetch,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || t("alerts.noticeEndFailed"));
      }
      await fetchFeedbackNotices();
      if (editingNotice?.id === noticeId) resetNoticeForm();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t("alerts.noticeEndFailed"));
    }
  };

  const handleDeleteNotice = async (noticeId: number) => {
    if (!token) return;
    if (!confirm(t("alerts.noticeDeleteConfirm"))) return;
    try {
      const res = await fetch(`/api/feedback-notices/${noticeId}`, {
        method: "DELETE",
        headers: authHeadersForFetch,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || t("alerts.noticeDeleteFailed"));
      }
      if (editingNotice?.id === noticeId) {
        resetNoticeForm();
      }
      await fetchFeedbackNotices();
    } catch (error: any) {
      logger.error("Failed to delete notice", { error });
      alert(error.message || t("alerts.noticeDeleteFailed"));
    }
  };

  // 공지사항 자동 새로고침 (주기 갱신은 silent로 해서 목록 깜박임 방지) — 메인 보드에서만
  useEffect(() => {
    if (currentView !== "main") return;
    if (token) {
      fetchFeedbackNotices(); // 최초 로드만 로딩 표시
      const interval = setInterval(
        () => fetchFeedbackNotices({ silent: true }),
        600000,
      ); // 10분
      return () => clearInterval(interval);
    }
  }, [token, selectedProjectId, currentView]);

  useEffect(() => {
    if (currentView !== "main") {
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    // 백엔드에서 실제 데이터 로드
    const loadData = async () => {
      logger.debug("[App] loadData started", {
        selectedProjectId,
        hasToken: !!token,
      });
      setDataLoading(true);
      setDataError(null);

      try {
        const allTickets: Ticket[] = [];

        // 레거시 /api/data 호출 제거 (더 이상 사용하지 않음)
        // 에이전트 데이터는 WebSocket 또는 /api/agents를 통해 로드됨

        // 이슈 데이터 로드 (카테고리 자동 분류 포함)
        try {
          // 속도 최적화(이전 방식):
          // - 날짜 필터가 없으면 "오늘(KST) 이슈"만 먼저 50개 로드 (더보기로 추가 로드)
          // - 날짜 필터가 있으면 해당 범위를 조회하되, 기본은 50개만 로드 (더보기로 추가 로드)
          const hasUserDateFilter = Boolean(
            dateFilter.startDate || dateFilter.endDate,
          );
          const implicitToday = !hasUserDateFilter;
          const effectiveStartDate =
            dateFilter.startDate ||
            (implicitToday ? getKstTodayYmd() : undefined);
          const effectiveEndDate =
            dateFilter.endDate ||
            (implicitToday ? getKstTodayYmd() : undefined);
          const initialLimit = 50;
          const params = new URLSearchParams();
          params.set("limit", String(initialLimit));
          params.set("offset", "0");
          if (effectiveStartDate) params.set("startDate", effectiveStartDate);
          if (effectiveEndDate) params.set("endDate", effectiveEndDate);
          // projectId가 있으면 전달 (전체 프로젝트 선택 시 null이므로 파라미터 전달 안함)
          // 백엔드에서 projectId가 undefined일 때 모든 이슈를 반환하도록 처리됨
          if (selectedProjectId !== null && selectedProjectId !== undefined) {
            params.set("projectId", String(selectedProjectId));
          }

          const queryString = params.toString();
          const url = `/api/issues?${queryString}`;
          logger.debug("[App] Issues API URL", { url });
          logger.debug("Loading issues with params", {
            selectedProjectId,
            projectIdParam: params.get("projectId"),
            url,
          });
          const issuesRes = await fetch(url, {
            headers: authHeadersOrUndefined,
            cache: "no-store", // 캐시 방지 (ngrok, 브라우저 캐시 방지)
            signal: controller.signal, // 이전 요청 취소 시 중단 (레이스 컨디션 방지)
          });
          if (issuesRes.ok) {
            const issuesData = await issuesRes.json();
            // 응답 형식: { success: true, data: { issues: [...], total, limit, offset } }
            // 또는 레거시 형식: { issues: [...] }
            let issues: any[] = [];
            if (issuesData.success && issuesData.data) {
              // 최신 형식: { success: true, data: { issues: [...], total, ... } }
              if (Array.isArray(issuesData.data.issues)) {
                issues = issuesData.data.issues;
              } else if (Array.isArray(issuesData.data)) {
                issues = issuesData.data;
              }
            } else if (Array.isArray(issuesData.issues)) {
              // 레거시 형식: { issues: [...] }
              issues = issuesData.issues;
            } else if (Array.isArray(issuesData.data)) {
              issues = issuesData.data;
            }

            logger.debug("[App] Parsed issues", { count: issues.length });
            const apiSeverityCounts = issues.reduce(
              (acc, issue: any) => {
                const sev = issue.severity ?? 3;
                acc[sev] = (acc[sev] || 0) + 1;
                return acc;
              },
              {} as Record<number, number>,
            );
            logger.debug("[App] API issues severity distribution", {
              apiSeverityCounts,
              total: issues.length,
            });

            if (issues.length === 0) {
              console.warn("[App] No issues parsed from response:", {
                success: issuesData.success,
                data: issuesData.data,
                rawResponse: issuesData,
              });
            }

            // total 값 저장 (무한 스크롤용)
            const total = issuesData.success
              ? issuesData.data?.total || issues.length
              : issuesData.total || issues.length;
            setTotalIssuesCount(total);
            // 오늘(암묵적) / 날짜필터 모두: 더보기로 추가 로드
            setHasMoreIssues(issues.length === initialLimit);

            if (Array.isArray(issues) && issues.length > 0) {
              logger.debug(`Loaded ${issues.length} issues from API`);
              // 디버깅: sourceCreatedAt 필드 확인
              if (issues.length > 0) {
                const sampleIssue = issues[0];
                logger.debug("Sample issue from API", {
                  id: sampleIssue.id,
                  title: sampleIssue.summary?.substring(0, 50),
                  createdAt: sampleIssue.createdAt,
                  sourceCreatedAt: sampleIssue.sourceCreatedAt,
                  hasSourceCreatedAt: !!sampleIssue.sourceCreatedAt,
                });
              }
              // 이슈를 Ticket 형식으로 변환
              const convertedTickets: Ticket[] = issues.map(
                (issue: any): Ticket => {
                  const severity = (issue.severity ?? 3) as TicketSeverity;
                  // SLA deadline 계산 (createdAt + severity별 응답 시간)
                  let slaDeadlineAt: number | undefined = undefined;
                  if (issue.createdAt && severity) {
                    const createdAt = new Date(issue.createdAt).getTime();
                    // severity 1: 10분, 2: 30분, 3: 60분
                    const responseTimeMs =
                      severity === 1
                        ? 10 * 60 * 1000
                        : severity === 2
                          ? 30 * 60 * 1000
                          : 60 * 60 * 1000;
                    slaDeadlineAt = createdAt + responseTimeMs;
                  }

                  const rawSource: string =
                    issue.source || issue.externalSource || "system";
                  const lowerSource = rawSource.toLowerCase();
                  const normalizedSource: Ticket["source"] =
                    lowerSource.includes("naver")
                      ? "naver"
                      : lowerSource.includes("discord")
                        ? "discord"
                        : "system";

                  const sentiment: Ticket["sentiment"] =
                    issue.sentiment === "neg"
                      ? "neg"
                      : issue.sentiment === "pos"
                        ? "pos"
                        : "neu";

                  const status = (
                    issue.status || "OPEN"
                  ).toUpperCase() as IssueWorkflowStatus;

                  return {
                    id: `issue_${issue.id}`,
                    issueId: issue.id,
                    title:
                      issue.summary ||
                      issue.detail ||
                      t("ticketFallback.issue"),
                    source: normalizedSource,
                    // keep original source identity for UI/meta (e.g. DISCOURSE_PLAYINZOI)
                    externalSource:
                      issue.externalSource || issue.source || null,
                    createdAt: new Date(issue.createdAt).getTime(),
                    severity,
                    sentiment,
                    status,
                    assignedAgentId:
                      issue.assignedAgentId ||
                      issue.assignedAgent?.id ||
                      undefined,
                    assignedAgentName:
                      issue.assignedAgentName ||
                      issue.assignedAgent?.name ||
                      null,
                    assigneeId:
                      issue.assignedAgentId ||
                      issue.assignedAgent?.id ||
                      undefined, // 대상자 필드 추가
                    link: issue.link || issue.sourceUrl || null,
                    tags: Array.isArray(issue.categories)
                      ? issue.categories
                      : [],
                    categories: Array.isArray(issue.categories)
                      ? issue.categories
                      : [],
                    primaryCategory:
                      issue.categoryGroup?.name && issue.category?.name
                        ? `${issue.categoryGroup.name} > ${issue.category.name}`
                        : issue.categoryGroup?.name ||
                          issue.category?.name ||
                          issue.primaryCategory ||
                          t("ticketFallback.other"),
                    checkedAt: issue.checkedAt
                      ? new Date(issue.checkedAt).getTime()
                      : null,
                    checkedBy: issue.checkedBy || null,
                    processedAt: issue.processedAt
                      ? new Date(issue.processedAt).getTime()
                      : null,
                    processedBy: issue.processedBy || null,
                    sourceCreatedAt: issue.sourceCreatedAt
                      ? new Date(issue.sourceCreatedAt).getTime()
                      : null,
                    // 날짜 필드 (YYYY-MM-DD 형식)
                    date:
                      issue.date ||
                      (issue.createdAt
                        ? new Date(issue.createdAt).toISOString().split("T")[0]
                        : undefined),
                    commentsCount:
                      issue.commentsCount || issue._count?.comments || 0,
                    scrapedComments: issue.scrapedComments || null,
                    isHotTopic: issue.isHotTopic || false,
                    // AI 분류 정보
                    aiClassificationReason:
                      issue.aiClassificationReason || null,
                    aiClassificationMethod:
                      issue.aiClassificationMethod || null,
                    trend: issue.trend || null,
                    // 카테고리 정보 (검수용)
                    categoryGroupId: issue.categoryGroupId || null,
                    categoryId: issue.categoryId || null,
                    categoryGroupName: issue.categoryGroup?.name || null,
                    categoryName: issue.category?.name || null,
                    // 원문 내용 (검수용)
                    detail: issue.detail || null,
                    summary: issue.summary || null,
                    // SLA 정보
                    slaDeadlineAt,
                    ...(() => {
                      const { cafeGameCode, gameName } = ticketCafeGameFields(
                        issue,
                        crawlerLookups,
                      );
                      if (!gameName && issue.externalSource?.includes("PUBG")) {
                        return {
                          cafeGameCode,
                          gameName: t("ticketFallback.otherSource"),
                        };
                      }
                      return { cafeGameCode, gameName };
                    })(),
                    // 스크린샷 경로
                    screenshotPath: issue.screenshotPath || null,
                    postImagePaths: issue.postImagePaths ?? null,
                    discourseViews: issue.discourseViews ?? null,
                    discourseLikeCount: issue.discourseLikeCount ?? null,
                    discourseReplyCount: issue.discourseReplyCount ?? null,
                    // 이미지 존재 여부
                    hasImages: Boolean(issue.hasImages),
                    // 로그인 필요 여부
                    requiresLogin: Boolean(issue.requiresLogin),
                    // 키워드 매칭 여부 (detail에서 마커 파싱)
                    hasKeywordMatch:
                      issue.detail?.startsWith("[KEYWORD_MATCHED]") || false,
                    // 보고서 제외 여부
                    excludedFromReport: Boolean(issue.excludedFromReport),
                    // 프로젝트 ID (이슈가 속한 프로젝트)
                    projectId: issue.projectId || null,
                  };
                },
              );

              logger.debug(
                `Converted ${convertedTickets.length} issues to tickets`,
              );

              // 중복 제거하며 추가
              const existingIds = new Set(allTickets.map((t) => t.id));
              convertedTickets.forEach((t: Ticket) => {
                if (!existingIds.has(t.id)) {
                  allTickets.push(t);
                  existingIds.add(t.id);
                }
              });
            } else {
              logger.warn("No issues in API response", { data: issuesData });
              console.warn("[App] No issues in API response:", {
                success: issuesData.success,
                hasData: !!issuesData.data,
                dataType: typeof issuesData.data,
                dataIsArray: Array.isArray(issuesData.data),
                dataKeys: issuesData.data ? Object.keys(issuesData.data) : [],
                rawResponse: issuesData,
              });
            }
          } else {
            logger.warn("Issues API request failed", {
              status: issuesRes.status,
              statusText: issuesRes.statusText,
            });
            console.error("[App] Issues API request failed:", {
              status: issuesRes.status,
              statusText: issuesRes.statusText,
              url: issuesRes.url,
            });
            let errorDetail = "";
            try {
              const errorText = await issuesRes.text();
              console.error("[App] Error response:", errorText);
              try {
                const errJson = JSON.parse(errorText);
                errorDetail =
                  errJson?.message ||
                  errJson?.error ||
                  errorText?.slice(0, 200);
              } catch {
                errorDetail = errorText?.slice(0, 200) || "";
              }
            } catch (e) {
              errorDetail = issuesRes.statusText || t("errors.readBodyFailed");
            }
            const errMsg =
              issuesRes.status === 401
                ? t("errors.loginRequiredShort")
                : issuesRes.status === 500
                  ? t("errors.serverError", {
                      detail: errorDetail || "Internal Server Error",
                    })
                  : t("errors.issuesLoad", {
                      status: String(issuesRes.status),
                      detail: errorDetail ? `: ${errorDetail}` : "",
                    });
            setDataError(errMsg);
          }
        } catch (e) {
          if (
            controller.signal.aborted ||
            (e instanceof Error && e.name === "AbortError")
          ) {
            throw e; // 외부 catch에서 무시
          }
          logger.error("Failed to load issues", { error: e });
          setDataError(
            e instanceof Error ? e.message : t("errors.issuesGeneric"),
          );
        }

        logger.debug(`Total tickets loaded: ${allTickets.length}`);

        // 디버깅: 로드된 티켓의 severity 분포 확인
        const loadedSeverityCounts = allTickets.reduce(
          (acc, t) => {
            acc[t.severity] = (acc[t.severity] || 0) + 1;
            return acc;
          },
          {} as Record<number, number>,
        );
        logger.debug("[App] Loaded tickets severity distribution", {
          loadedSeverityCounts,
          total: allTickets.length,
        });

        // 모든 티켓을 한 번에 설정 (취소된 요청이면 무시)
        if (!controller.signal.aborted) {
          setTickets(allTickets);
          logger.debug("[App] Tickets set", { count: allTickets.length });
        }

        // 헤더의 "총/Sev1/열림" 카운트는 목록(limit=200)과 분리해서,
        // 서버에서 오늘(KST) 기준 COUNT만 빠르게 가져온다.
        try {
          const hasUserDateFilter = Boolean(
            dateFilter.startDate || dateFilter.endDate,
          );
          const implicitToday = !hasUserDateFilter;
          const effectiveStartDate =
            dateFilter.startDate ||
            (implicitToday ? getKstTodayYmd() : undefined);
          const effectiveEndDate =
            dateFilter.endDate ||
            (implicitToday ? getKstTodayYmd() : undefined);
          const qs = new URLSearchParams();
          if (selectedProjectId !== null && selectedProjectId !== undefined) {
            qs.set("projectId", String(selectedProjectId));
          }
          if (effectiveStartDate) qs.set("startDate", effectiveStartDate);
          if (effectiveEndDate) qs.set("endDate", effectiveEndDate);
          const countsRes = await fetch(
            `/api/issues/game-counts?${qs.toString()}`,
            {
              headers: authHeadersOrUndefined,
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (countsRes.ok) {
            const countsJson = await countsRes.json();
            const data = countsJson?.success ? countsJson.data : countsJson;
            setServerGameCounts(data?.byCafeGame ?? null);
          }
        } catch {
          // ignore
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return; // 새 요청이 시작됨 - 무시
        }
        logger.error("데이터 로드 실패", { error });
        const errMsg =
          error instanceof Error ? error.message : t("errors.dataLoadGeneric");
        const isFailedToFetch =
          errMsg.includes("Failed to fetch") || errMsg.includes("fetch");
        setDataError(isFailedToFetch ? t("errors.backendUnreachable") : errMsg);
        setTickets([]);
      } finally {
        if (!controller.signal.aborted) {
          setDataLoading(false);
        }
      }
    };

    logger.debug("[App] loadData effect triggered", {
      selectedProjectId,
      hasToken: !!token,
    });
    loadData();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    currentView,
    selectedProjectId,
    token,
    dateFilter.startDate,
    dateFilter.endDate,
    crawlerLookups,
    t,
    authHeadersOrUndefined,
  ]);

  // 무한 스크롤: 추가 이슈 로드
  const loadMoreIssues = useCallback(async () => {
    if (loadingMore || !hasMoreIssues || !token) return;

    setLoadingMore(true);
    try {
      const currentOffset = tickets.length;
      // 무한 스크롤: 한 번에 100개씩 추가 로드 (성능 최적화)
      const params = new URLSearchParams({
        offset: String(currentOffset),
        limit: "100",
      });

      // 기본(날짜 필터 미지정)은 "오늘(KST)"로 제한해서, 오늘 이슈를 50개씩 열어 속도 개선
      const hasUserDateFilter = Boolean(
        dateFilter.startDate || dateFilter.endDate,
      );
      const implicitToday = !hasUserDateFilter;
      const effectiveStartDate =
        dateFilter.startDate || (implicitToday ? getKstTodayYmd() : undefined);
      const effectiveEndDate =
        dateFilter.endDate || (implicitToday ? getKstTodayYmd() : undefined);
      if (effectiveStartDate) params.set("startDate", effectiveStartDate);
      if (effectiveEndDate) params.set("endDate", effectiveEndDate);

      // 프로젝트 필터 적용 (전체 프로젝트 선택 시 null이므로 파라미터 전달 안함)
      if (selectedProjectId !== null && selectedProjectId !== undefined) {
        params.set("projectId", String(selectedProjectId));
      }

      const queryString = params.toString();
      const url = `/api/issues?${queryString}`;
      const issuesRes = await fetch(url, {
        headers: authHeadersOrUndefined,
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });

      if (issuesRes.ok) {
        const issuesData = await issuesRes.json();
        const issues = issuesData.success
          ? issuesData.data?.issues || issuesData.data || []
          : issuesData.issues ||
            issuesData.data?.issues ||
            issuesData.data ||
            [];

        if (Array.isArray(issues) && issues.length > 0) {
          logger.debug(`Loaded ${issues.length} more issues from API`, {
            offset: currentOffset,
          });

          // 이슈를 Ticket 형식으로 변환 (기존 로직과 동일)
          const convertedTickets: Ticket[] = issues.map(
            (issue: any): Ticket => {
              const severity = (issue.severity ?? 3) as TicketSeverity;
              let slaDeadlineAt: number | undefined = undefined;
              if (issue.createdAt && severity) {
                const createdAt = new Date(issue.createdAt).getTime();
                const responseTimeMs =
                  severity === 1
                    ? 10 * 60 * 1000
                    : severity === 2
                      ? 30 * 60 * 1000
                      : 60 * 60 * 1000;
                slaDeadlineAt = createdAt + responseTimeMs;
              }

              const rawSource: string =
                issue.source || issue.externalSource || "system";
              const lowerSource = rawSource.toLowerCase();
              const normalizedSource: Ticket["source"] = lowerSource.includes(
                "naver",
              )
                ? "naver"
                : lowerSource.includes("discord")
                  ? "discord"
                  : "system";

              const sentiment: Ticket["sentiment"] =
                issue.sentiment === "neg"
                  ? "neg"
                  : issue.sentiment === "pos"
                    ? "pos"
                    : "neu";

              const status = (
                issue.status || "OPEN"
              ).toUpperCase() as IssueWorkflowStatus;

              return {
                id: `issue_${issue.id}`,
                issueId: issue.id,
                title:
                  issue.summary || issue.detail || t("ticketFallback.issue"),
                source: normalizedSource,
                createdAt: new Date(issue.createdAt).getTime(),
                severity,
                sentiment,
                status,
                assignedAgentId:
                  issue.assignedAgentId || issue.assignedAgent?.id || undefined,
                assignedAgentName:
                  issue.assignedAgentName || issue.assignedAgent?.name || null,
                assigneeId:
                  issue.assignedAgentId || issue.assignedAgent?.id || undefined,
                link: issue.link || issue.sourceUrl || null,
                tags: Array.isArray(issue.categories) ? issue.categories : [],
                categories: Array.isArray(issue.categories)
                  ? issue.categories
                  : [],
                primaryCategory:
                  issue.categoryGroup?.name && issue.category?.name
                    ? `${issue.categoryGroup.name} > ${issue.category.name}`
                    : issue.categoryGroup?.name ||
                      issue.category?.name ||
                      issue.primaryCategory ||
                      t("ticketFallback.other"),
                checkedAt: issue.checkedAt
                  ? new Date(issue.checkedAt).getTime()
                  : null,
                checkedBy: issue.checkedBy || null,
                processedAt: issue.processedAt
                  ? new Date(issue.processedAt).getTime()
                  : null,
                processedBy: issue.processedBy || null,
                sourceCreatedAt: issue.sourceCreatedAt
                  ? new Date(issue.sourceCreatedAt).getTime()
                  : null,
                commentsCount:
                  issue.commentsCount || issue._count?.comments || 0,
                scrapedComments: issue.scrapedComments || null,
                isHotTopic: issue.isHotTopic || false,
                aiClassificationReason: issue.aiClassificationReason || null,
                aiClassificationMethod: issue.aiClassificationMethod || null,
                trend: issue.trend || null,
                categoryGroupId: issue.categoryGroupId || null,
                categoryId: issue.categoryId || null,
                categoryGroupName: issue.categoryGroup?.name || null,
                categoryName: issue.category?.name || null,
                detail: issue.detail || null,
                summary: issue.summary || null,
                slaDeadlineAt,
                ...(() => {
                  const { cafeGameCode, gameName } = ticketCafeGameFields(
                    issue,
                    crawlerLookups,
                  );
                  if (!gameName && issue.externalSource?.includes("PUBG")) {
                    return {
                      cafeGameCode,
                      gameName: t("ticketFallback.otherSource"),
                    };
                  }
                  return { cafeGameCode, gameName };
                })(),
                screenshotPath: issue.screenshotPath || null,
                postImagePaths: issue.postImagePaths ?? null,
                discourseViews: issue.discourseViews ?? null,
                discourseLikeCount: issue.discourseLikeCount ?? null,
                discourseReplyCount: issue.discourseReplyCount ?? null,
                hasImages: Boolean(issue.hasImages),
                requiresLogin: Boolean(issue.requiresLogin),
                hasKeywordMatch:
                  issue.detail?.startsWith("[KEYWORD_MATCHED]") || false,
                excludedFromReport: Boolean(issue.excludedFromReport),
                projectId: issue.projectId || null,
              };
            },
          );

          // 기존 tickets에 추가 (중복 제거)
          setTickets((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newTickets = convertedTickets.filter(
              (t) => !existingIds.has(t.id),
            );
            return [...prev, ...newTickets];
          });

          // hasMoreIssues 업데이트
          // totalIssuesCount는 서버 쿼리 조건에 따라 일치하지 않을 수 있어서,
          // 페이지네이션은 "요청한 limit을 꽉 채워서 왔는지"로 판정한다.
          setHasMoreIssues(issues.length === 100);

          logger.debug(`Added ${convertedTickets.length} more issues`, {
            added: convertedTickets.length,
            received: issues.length,
            hasMore: issues.length === 100,
          });
        } else {
          // 더 가져올 게 없으면 종료
          setHasMoreIssues(false);
        }
      }
    } catch (error) {
      logger.error("Failed to load more issues", { error });
    } finally {
      setLoadingMore(false);
    }
  }, [
    loadingMore,
    hasMoreIssues,
    token,
    tickets.length,
    selectedProjectId,
    debouncedSearchQuery,
    authHeadersOrUndefined,
    totalIssuesCount,
    dateFilter.startDate,
    dateFilter.endDate,
    getKstTodayYmd,
    t,
    crawlerLookups,
  ]);

  // IntersectionObserver로 무한 스크롤 구현
  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger || !hasMoreIssues) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreIssues && !loadingMore) {
          logger.debug("[InfiniteScroll] Trigger visible, loading more issues");
          loadMoreIssues();
        }
      },
      // 페이지 하단 전역 트리거 (게임 컬럼 2개에서 ref가 덮어써지는 문제 방지)
      { threshold: 0.1, rootMargin: "200px" },
    );

    observer.observe(trigger);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreIssues, loadingMore, loadMoreIssues]);

  // WebSocket 실시간 이벤트 핸들러 메모이제이션 (무한 루프 방지)
  // setAgents, setTickets는 React setState 함수이므로 안정적인 참조를 유지하지만,
  // 의존성 배열에서 제거하여 불필요한 재생성 방지
  const realtimeHandlers = useMemo(
    (): RealtimeEventHandlers => ({
      onAgentStatusUpdate: (payload) => {
        setAgents((prev) => {
          const agentIndex = prev.findIndex(
            (agent) => agent.id === payload.agentId,
          );
          if (agentIndex === -1) return prev; // 에이전트가 없으면 변경 없음
          return prev.map((agent) =>
            agent.id === payload.agentId
              ? {
                  ...agent,
                  status: payload.status as AgentStatus,
                  handling: payload.handling ?? agent.handling,
                  todayResolved: payload.todayResolved ?? agent.todayResolved,
                  avgHandleSec: payload.avgHandleSec ?? agent.avgHandleSec,
                }
              : agent,
          );
        });
      },
      onIssueCreated: (payload) => {
        logger.info("[Realtime] Issue created event received", {
          issueId: payload?.issueId,
          title: payload?.title,
          severity: payload?.severity,
          source: payload?.source,
          projectId: payload?.projectId,
          hasPayload: !!payload,
        });

        if (!payload?.issueId) {
          logger.warn(
            "[Realtime] Issue created event ignored: missing issueId",
            { payload },
          );
          return; // issueId가 없으면 무시
        }

        // 데스크톱 알림 표시
        try {
          notifyNewIssue({
            id: payload.issueId,
            title: payload.title || t("ticketFallback.newIssue"),
            severity: payload.severity ? `SEV${payload.severity}` : undefined,
            source: payload.source,
          });
        } catch (notifyError) {
          logger.error("[Realtime] Failed to show notification for new issue", {
            issueId: payload.issueId,
            error: notifyError,
          });
        }

        // 새 이슈를 Ticket 형식으로 변환하여 목록에 추가
        const severity = (payload.severity ?? 3) as TicketSeverity;
        const rawSource: string = payload.source || "system";
        const lowerSource = rawSource.toLowerCase();
        const normalizedSource: Ticket["source"] = lowerSource.includes("naver")
          ? "naver"
          : lowerSource.includes("discord")
            ? "discord"
            : "system";

        const status = (
          payload.status || "OPEN"
        ).toUpperCase() as IssueWorkflowStatus;
        const createdAt = payload.createdAt
          ? new Date(payload.createdAt).getTime()
          : Date.now();

        // SLA deadline 계산
        let slaDeadlineAt: number | undefined = undefined;
        if (payload.createdAt && severity) {
          const responseTimeMs =
            severity === 1
              ? 10 * 60 * 1000
              : severity === 2
                ? 30 * 60 * 1000
                : 60 * 60 * 1000;
          slaDeadlineAt = createdAt + responseTimeMs;
        }

        const externalSource = payload.source || null;
        const { cafeGameCode, gameName } = ticketCafeGameFields(
          { externalSource },
          crawlerLookups,
        );

        const newTicket: Ticket = {
          id: `issue_${payload.issueId}`,
          issueId: payload.issueId,
          title: payload.title || t("ticketFallback.issue"),
          source: normalizedSource,
          createdAt,
          severity,
          sentiment: "neu",
          status,
          link: null,
          tags: [],
          categories: payload.category ? [payload.category] : [],
          primaryCategory: payload.category || t("ticketFallback.other"),
          date: payload.createdAt
            ? new Date(payload.createdAt).toISOString().split("T")[0]
            : undefined,
          slaDeadlineAt,
          externalSource,
          cafeGameCode,
          gameName: gameName || null,
        };

        // 프로젝트 필터링: selectedProjectId가 있으면 해당 프로젝트의 이슈만 추가
        const payloadProjectId =
          payload.projectId !== undefined ? Number(payload.projectId) : null;
        if (
          selectedProjectId !== null &&
          payloadProjectId !== null &&
          payloadProjectId !== selectedProjectId
        ) {
          logger.debug("[Realtime] Issue from different project, skipping", {
            issueId: payload.issueId,
            payloadProjectId,
            selectedProjectId,
          });
          return; // 다른 프로젝트의 이슈는 추가하지 않음
        }

        // 티켓 목록에 추가 (중복 방지)
        setTickets((prev) => {
          const beforeCount = prev.length;
          // 이미 존재하는지 확인
          if (prev.find((t) => t.issueId === payload.issueId)) {
            logger.warn("[Realtime] Issue already exists in list, skipping", {
              issueId: payload.issueId,
              currentListSize: beforeCount,
            });
            return prev;
          }
          // 최신순으로 맨 앞에 추가
          const updated = [newTicket, ...prev];
          logger.info("[Realtime] Adding new issue to list", {
            issueId: payload.issueId,
            title: payload.title,
            beforeCount,
            afterCount: updated.length,
            ticketData: {
              id: newTicket.id,
              status: newTicket.status,
              severity: newTicket.severity,
              source: newTicket.source,
            },
          });

          // 커스텀 이벤트 발생 (검증용)
          window.dispatchEvent(
            new CustomEvent("issueCreated", {
              detail: { issueId: payload.issueId },
            }),
          );

          return updated;
        });

        // totalIssuesCount 증가
        setTotalIssuesCount((prev) => {
          const newCount = prev + 1;
          logger.debug("[Realtime] Total issues count updated", {
            before: prev,
            after: newCount,
          });
          return newCount;
        });
      },
      onIssueUpdated: (payload) => {
        logger.info("[Realtime] Issue updated event received", {
          issueId: payload?.issueId,
          status: payload?.status,
          assignedAgentId: payload?.assignedAgentId,
          severity: payload?.severity,
          hasPayload: !!payload,
        });

        if (!payload?.issueId) {
          logger.warn(
            "[Realtime] Issue updated event ignored: missing issueId",
            { payload },
          );
          return; // issueId가 없으면 무시
        }

        // 모바일 최적화: requestAnimationFrame으로 배치 업데이트
        requestAnimationFrame(() => {
          setTickets((prev) => {
            const ticketIndex = prev.findIndex(
              (ticket) => ticket.issueId === payload.issueId,
            );
            if (ticketIndex === -1) {
              // 목록에 없는 이슈가 업데이트되면 API를 통해 가져와서 추가
              logger.info(
                "[Realtime] Issue updated but not found in list, will fetch from API",
                {
                  issueId: payload.issueId,
                  currentListSize: prev.length,
                },
              );

              // 비동기 작업은 setTickets 외부에서 처리
              if (token) {
                (async () => {
                  try {
                    const fetchUrl = selectedProjectId
                      ? `/api/issues/${payload.issueId}?projectId=${selectedProjectId}`
                      : `/api/issues/${payload.issueId}`;

                    const res = await fetch(fetchUrl, {
                      headers: authHeadersOrUndefined,
                    });

                    if (!res.ok) {
                      logger.error(
                        "[Realtime] Failed to fetch issue for update",
                        {
                          issueId: payload.issueId,
                          status: res.status,
                        },
                      );
                      return;
                    }

                    const body = await res.json();
                    const issueData = body.data || body;
                    if (issueData && issueData.id) {
                      // 이슈 데이터를 Ticket 형식으로 변환
                      const severity = (issueData.severity ??
                        3) as TicketSeverity;
                      const rawSource: string = issueData.source || "system";
                      const lowerSource = rawSource.toLowerCase();
                      const normalizedSource: Ticket["source"] =
                        lowerSource.includes("naver")
                          ? "naver"
                          : lowerSource.includes("discord")
                            ? "discord"
                            : "system";

                      const status = (
                        issueData.status || "OPEN"
                      ).toUpperCase() as IssueWorkflowStatus;
                      const createdAt = issueData.createdAt
                        ? new Date(issueData.createdAt).getTime()
                        : Date.now();

                      // SLA deadline 계산
                      let slaDeadlineAt: number | undefined = undefined;
                      if (issueData.createdAt && severity) {
                        const responseTimeMs =
                          severity === 1
                            ? 10 * 60 * 1000
                            : severity === 2
                              ? 30 * 60 * 1000
                              : 60 * 60 * 1000;
                        slaDeadlineAt = createdAt + responseTimeMs;
                      }

                      const externalSource =
                        issueData.externalSource || issueData.source || null;
                      const { cafeGameCode, gameName } = ticketCafeGameFields(
                        issueData,
                        crawlerLookups,
                      );

                      const newTicket: Ticket = {
                        id: `issue_${issueData.id}`,
                        issueId: issueData.id,
                        title:
                          issueData.summary ||
                          issueData.detail ||
                          issueData.title ||
                          t("ticketFallback.issue"),
                        source: normalizedSource,
                        createdAt,
                        severity,
                        sentiment: (issueData.sentiment ||
                          "neu") as Ticket["sentiment"],
                        status,
                        assignedAgentId:
                          issueData.assignedAgentId ||
                          issueData.assignedAgent?.id ||
                          null,
                        assignedAgentName:
                          issueData.assignedAgentName ||
                          issueData.assignedAgent?.name ||
                          null,
                        link: issueData.link || issueData.originalUrl || null,
                        tags: Array.isArray(issueData.categories)
                          ? issueData.categories
                          : [],
                        categories: Array.isArray(issueData.categories)
                          ? issueData.categories
                          : [],
                        primaryCategory:
                          issueData.category?.name ||
                          issueData.primaryCategory ||
                          t("ticketFallback.other"),
                        date: issueData.createdAt
                          ? new Date(issueData.createdAt)
                              .toISOString()
                              .split("T")[0]
                          : undefined,
                        slaDeadlineAt,
                        externalSource,
                        cafeGameCode,
                        gameName: issueData.gameName || gameName || null,
                        checkedAt: issueData.checkedAt
                          ? new Date(issueData.checkedAt).getTime()
                          : null,
                        processedAt: issueData.processedAt
                          ? new Date(issueData.processedAt).getTime()
                          : null,
                      };

                      // 프로젝트 필터링 확인
                      const issueProjectId =
                        issueData.projectId !== undefined
                          ? Number(issueData.projectId)
                          : null;
                      if (
                        selectedProjectId !== null &&
                        issueProjectId !== null &&
                        issueProjectId !== selectedProjectId
                      ) {
                        logger.debug(
                          "[Realtime] Fetched issue from different project, skipping",
                          {
                            issueId: payload.issueId,
                            issueProjectId,
                            selectedProjectId,
                          },
                        );
                        return;
                      }

                      // 목록에 추가
                      setTickets((prevTickets) => {
                        if (
                          prevTickets.find((t) => t.issueId === issueData.id)
                        ) {
                          // 이미 추가되었으면 업데이트만
                          return prevTickets.map((t) =>
                            t.issueId === issueData.id ? newTicket : t,
                          );
                        }
                        logger.info("[Realtime] Adding fetched issue to list", {
                          issueId: issueData.id,
                          title: newTicket.title,
                        });
                        return [newTicket, ...prevTickets];
                      });
                    }
                  } catch (error) {
                    logger.error(
                      "[Realtime] Failed to fetch issue for update",
                      {
                        issueId: payload.issueId,
                        error,
                      },
                    );
                  }
                })();
              }

              return prev; // 일단 이전 배열 반환 (비동기로 추가됨)
            }

            const existingTicket = prev[ticketIndex];
            logger.debug("[Realtime] Found ticket to update", {
              issueId: payload.issueId,
              index: ticketIndex,
              currentStatus: existingTicket.status,
              currentAssignedAgent: existingTicket.assignedAgentId,
            });
            const newCheckedAt = payload.checkedAt
              ? new Date(payload.checkedAt).getTime()
              : existingTicket.checkedAt;
            const newProcessedAt = payload.processedAt
              ? new Date(payload.processedAt).getTime()
              : existingTicket.processedAt;
            const newStatus = (payload.status ||
              existingTicket.status) as IssueWorkflowStatus;
            const newAssignedAgentId =
              payload.assignedAgentId !== undefined
                ? payload.assignedAgentId
                : existingTicket.assignedAgentId;
            const newAssignedAgentName =
              payload.assignedAgentName !== undefined
                ? payload.assignedAgentName
                : existingTicket.assignedAgentName;
            const newSeverity =
              payload.severity !== undefined && payload.severity !== null
                ? (Number(payload.severity) as TicketSeverity)
                : existingTicket.severity;

            const newTitle =
              payload.title !== undefined &&
              payload.title !== null &&
              String(payload.title).trim() !== ""
                ? String(payload.title)
                : existingTicket.title;
            const newPrimaryCategory =
              payload.category !== undefined
                ? payload.category
                : existingTicket.primaryCategory;

            let newSource = existingTicket.source;
            if (
              payload.source !== undefined &&
              payload.source !== null &&
              String(payload.source).trim() !== ""
            ) {
              const lowerSource = String(payload.source).toLowerCase();
              newSource = lowerSource.includes("naver")
                ? "naver"
                : lowerSource.includes("discord")
                  ? "discord"
                  : "system";
            }

            // 실제로 변경이 있는지 확인 (무한 루프 방지)
            const hasStatusChanged = existingTicket.status !== newStatus;
            const hasOtherChanges =
              existingTicket.assignedAgentId !== newAssignedAgentId ||
              existingTicket.assignedAgentName !== newAssignedAgentName ||
              existingTicket.severity !== newSeverity ||
              existingTicket.checkedAt !== newCheckedAt ||
              existingTicket.processedAt !== newProcessedAt ||
              existingTicket.title !== newTitle ||
              (existingTicket.primaryCategory ?? null) !==
                (newPrimaryCategory ?? null) ||
              existingTicket.source !== newSource;

            if (!hasStatusChanged && !hasOtherChanges) {
              logger.debug("[Realtime] No changes detected, skipping update", {
                issueId: payload.issueId,
                currentStatus: existingTicket.status,
                newStatus,
                currentAssignedAgent: existingTicket.assignedAgentId,
                newAssignedAgent: newAssignedAgentId,
              });
              return prev; // 변경이 없으면 이전 배열 그대로 반환
            }

            // 상세한 상태 업데이트 전후 비교 로그
            const beforeState = {
              status: existingTicket.status,
              assignedAgentId: existingTicket.assignedAgentId,
              assignedAgentName: existingTicket.assignedAgentName,
              severity: existingTicket.severity,
              checkedAt: existingTicket.checkedAt,
              processedAt: existingTicket.processedAt,
            };
            const afterState = {
              status: newStatus,
              assignedAgentId: newAssignedAgentId,
              assignedAgentName: newAssignedAgentName,
              severity: newSeverity,
              checkedAt: newCheckedAt,
              processedAt: newProcessedAt,
            };

            logger.info(
              "[Realtime] Updating ticket - detailed state comparison",
              {
                issueId: payload.issueId,
                title: existingTicket.title,
                before: beforeState,
                after: afterState,
                changes: {
                  status: hasStatusChanged
                    ? { from: existingTicket.status, to: newStatus }
                    : null,
                  assignedAgent:
                    existingTicket.assignedAgentId !== newAssignedAgentId
                      ? {
                          from: existingTicket.assignedAgentId,
                          to: newAssignedAgentId,
                        }
                      : null,
                  severity:
                    existingTicket.severity !== newSeverity
                      ? { from: existingTicket.severity, to: newSeverity }
                      : null,
                  checkedAt:
                    existingTicket.checkedAt !== newCheckedAt
                      ? { from: existingTicket.checkedAt, to: newCheckedAt }
                      : null,
                  processedAt:
                    existingTicket.processedAt !== newProcessedAt
                      ? { from: existingTicket.processedAt, to: newProcessedAt }
                      : null,
                },
              },
            );

            // 상태 변경 시 데스크톱 알림 표시
            if (hasStatusChanged) {
              try {
                notifyIssueUpdate({
                  id: payload.issueId,
                  title: existingTicket.title || t("ticketFallback.issue"),
                  status: newStatus,
                });
              } catch (notifyError) {
                logger.error(
                  "[Realtime] Failed to show notification for issue update",
                  {
                    issueId: payload.issueId,
                    error: notifyError,
                  },
                );
              }
            }

            const updated = prev.map((ticket) => {
              if (ticket.issueId === payload.issueId) {
                const categoryFromPayload = payload.category !== undefined;
                const nextCategories = categoryFromPayload
                  ? newPrimaryCategory != null &&
                    String(newPrimaryCategory).trim() !== ""
                    ? [String(newPrimaryCategory)]
                    : []
                  : ticket.categories;
                return {
                  ...ticket,
                  title: newTitle,
                  primaryCategory: newPrimaryCategory,
                  ...(categoryFromPayload
                    ? { categories: nextCategories }
                    : {}),
                  source: newSource,
                  status: newStatus,
                  assignedAgentId: newAssignedAgentId,
                  assignedAgentName: newAssignedAgentName,
                  severity: newSeverity,
                  checkedAt: newCheckedAt,
                  processedAt: newProcessedAt,
                };
              }
              return ticket;
            });

            logger.debug(
              "[Realtime] Ticket updated successfully - state after update",
              {
                issueId: payload.issueId,
                updatedTicket: {
                  status: newStatus,
                  assignedAgentId: newAssignedAgentId,
                  assignedAgentName: newAssignedAgentName,
                  severity: newSeverity,
                  checkedAt: newCheckedAt,
                  processedAt: newProcessedAt,
                },
                listSize: updated.length,
                timestamp: new Date().toISOString(),
              },
            );

            // 커스텀 이벤트 발생 (검증용)
            window.dispatchEvent(
              new CustomEvent("issueUpdated", {
                detail: { issueId: payload.issueId },
              }),
            );

            return updated;
          });
        });
      },
      onIssueCommentsUpdated: (payload) => {
        if (!payload?.issueId || !token) {
          return;
        }
        (async () => {
          try {
            const res = await fetch(
              withProjectParam(`/api/issues/${payload.issueId}`),
              {
                headers: authHeadersOrUndefined,
              },
            );
            if (!res.ok) {
              logger.warn(
                "[Realtime] issue_comments_updated: fetch issue failed",
                {
                  issueId: payload.issueId,
                  status: res.status,
                },
              );
              return;
            }
            const body = await res.json();
            const issueData = body.data || body;
            const commentsCount =
              issueData.commentsCount ??
              issueData.commentCount ??
              payload.commentCount ??
              0;
            const scrapedComments =
              issueData.scrapedComments !== undefined
                ? issueData.scrapedComments
                : null;

            setTickets((prev) =>
              prev.map((t) =>
                t.issueId === payload.issueId
                  ? { ...t, commentsCount, scrapedComments }
                  : t,
              ),
            );
            setSelectedTicket((prev) =>
              prev?.issueId === payload.issueId
                ? { ...prev, commentsCount, scrapedComments }
                : prev,
            );

            // 관리 화면(CommentWatchManagement 등)에서 실시간 반영할 수 있도록 별도 이벤트 전파
            window.dispatchEvent(
              new CustomEvent("issueCommentsUpdated", {
                detail: {
                  issueId: payload.issueId,
                  projectId: payload.projectId ?? null,
                },
              }),
            );
          } catch (error) {
            logger.error("[Realtime] issue_comments_updated merge failed", {
              issueId: payload.issueId,
              error,
            });
          }
        })();
      },
      onSlaViolation: (payload) => {
        logger.warn("[Realtime] SLA Violation detected", { payload });

        // 데스크톱 알림 표시
        // payload.issueIds는 배열이므로 첫 번째 이슈 ID 사용
        if (payload?.issueIds && payload.issueIds.length > 0) {
          const firstIssueId = payload.issueIds[0];
          notifySlaViolation({
            id: firstIssueId,
            title: t("notifications.slaViolation", {
              count: payload.issueIds.length,
            }),
            slaStatus: payload.severity,
          });
        }

        // 필요시 데이터 새로고침
      },
      onInitialState: (payload) => {
        // 안전하게 agents와 tickets 설정
        if (payload && Array.isArray(payload.agents)) {
          setAgents(payload.agents);
        }
        if (payload && Array.isArray(payload.tickets)) {
          // tickets를 Ticket 형식으로 변환 필요시 여기서 처리
          logger.debug("[Realtime] Initial state received", {
            agents: payload.agents?.length,
            tickets: payload.tickets?.length,
          });
        }
      },
      onStateUpdate: (payload) => {
        // 주기적 업데이트: agents만 업데이트
        if (payload && Array.isArray(payload.agents)) {
          setAgents(payload.agents);
        }
      },
      // 레거시 호환 (deprecated)
      onInitial: (payload) => {
        if (payload && Array.isArray(payload.agents)) {
          setAgents(payload.agents);
        }
      },
      onUpdate: (payload) => {
        if (payload && Array.isArray(payload.agents)) {
          setAgents(payload.agents);
        }
      },
    }),
    [
      selectedProjectId,
      token,
      authHeadersOrUndefined,
      withProjectParam,
      t,
      crawlerLookups,
    ],
  ); // 필요한 의존성 추가

  // 페이지 새로고침 감지 (검증용)
  useEffect(() => {
    const initialLoadTime = Date.now();
    const checkReload = () => {
      const timeSinceLoad = Date.now() - initialLoadTime;
      // 5초 이내에 페이지가 리로드되면 경고 (이슈 이벤트 처리 중 리로드 방지)
      if (timeSinceLoad < 5000) {
        logger.warn(
          "[App] Potential page reload detected during realtime update",
          {
            timeSinceLoad,
            timestamp: new Date().toISOString(),
          },
        );
      }
    };

    // 이슈 이벤트 발생 시 리로드 체크
    const handleIssueEvent = () => {
      setTimeout(checkReload, 100);
    };

    window.addEventListener("beforeunload", checkReload);
    // 커스텀 이벤트로 이슈 업데이트 감지
    window.addEventListener("issueUpdated", handleIssueEvent);
    window.addEventListener("issueCreated", handleIssueEvent);

    return () => {
      window.removeEventListener("beforeunload", checkReload);
      window.removeEventListener("issueUpdated", handleIssueEvent);
      window.removeEventListener("issueCreated", handleIssueEvent);
    };
  }, []);

  // WebSocket 실시간 이벤트 처리
  const {
    connected: wsConnected,
    error: wsError,
    reconnect: wsReconnect,
  } = useRealtime({
    autoReconnect: true,
    reconnectDelay: 5000, // 5초 딜레이
    maxReconnectAttempts: 5, // 최대 5회 재시도
    handlers: realtimeHandlers,
  });

  // WebSocket 연결 상태 모니터링 및 에러 처리 (유휴 시 반복 로그/알림 방지)
  useEffect(() => {
    if (wsError) {
      // 연결 실패 세션당 한 번만 로그·알림 (재연결 시도마다 반복하지 않음)
      if (!wsErrorLoggedRef.current) {
        wsErrorLoggedRef.current = true;
        logger.warn(
          "[Realtime] WebSocket 연결 실패. 자동 재연결을 시도합니다.",
          {
            error: wsError.message,
            timestamp: new Date().toISOString(),
          },
        );
        try {
          if (getNotificationPermission() === "granted") {
            new Notification(t("ws.errorTitle"), {
              body: t("ws.errorBody"),
              icon: "/favicon.png",
              tag: "websocket-error",
              requireInteraction: false,
            });
          }
        } catch {
          // 알림 실패는 무시
        }
      }
    } else if (wsConnected && !wsError) {
      wsErrorLoggedRef.current = false; // 다음 오류 시 다시 한 번 로그/알림 가능
      logger.info("[Realtime] WebSocket connection established successfully", {
        timestamp: new Date().toISOString(),
      });
    }
  }, [wsError, wsConnected, t]);

  // 앱 시작 시 알림 권한 자동 요청
  useEffect(() => {
    const initNotificationPermission = async () => {
      const permission = getNotificationPermission();
      if (permission === "default") {
        // 권한이 아직 요청되지 않은 경우 자동으로 요청
        logger.debug(
          "[Notifications] Requesting notification permission on app start",
        );
        const newPermission = await requestNotificationPermission();
        logger.debug("[Notifications] Permission result", {
          permission: newPermission,
        });
      } else {
        logger.debug("[Notifications] Current permission", { permission });
      }
    };
    initNotificationPermission();
  }, []);

  // 알림 클릭 시 이슈 선택 이벤트 리스너
  useEffect(() => {
    const handleSelectIssue = async (event: CustomEvent) => {
      const { issueId } = event.detail;
      if (!issueId) return;

      // 해당 이슈 ID를 가진 티켓 찾기
      let ticket = tickets.find((t) => t.issueId === issueId);

      // 티켓을 찾지 못한 경우, API를 통해 이슈 정보를 가져와서 티켓 생성
      if (!ticket && token) {
        try {
          const res = await fetch(withProjectParam(`/api/issues/${issueId}`), {
            headers: authHeadersOrUndefined,
          });
          if (res.ok) {
            const body = await res.json();
            const issueData = body.data || body;
            // 이슈 데이터를 Ticket 형식으로 변환
            // (중요) 목록 로딩 때와 동일한 수준의 필드(특히 externalSource/cafeGameCode)를 채워야
            // 게임 컬럼 분류가 "Other"로 새지 않는다.
            const externalSource =
              issueData.externalSource || issueData.source || null;
            const { cafeGameCode, gameName } = ticketCafeGameFields(
              {
                externalSource,
                monitoredBoard: issueData.monitoredBoard || null,
                monitoredBoard_cafeGame:
                  issueData.monitoredBoard_cafeGame || null,
              },
              crawlerLookups,
            );
            ticket = {
              id: `issue_${issueId}`,
              issueId: issueId,
              title:
                issueData.summary ||
                issueData.title ||
                issueData.subject ||
                issueData.detail ||
                t("ticketFallback.noTitle"),
              link:
                issueData.link ||
                issueData.sourceUrl ||
                issueData.originalUrl ||
                issueData.url ||
                "",
              source: (issueData.source || "system") as Ticket["source"],
              severity: (issueData.severity || 3) as TicketSeverity,
              sentiment: (issueData.sentiment || "neu") as Ticket["sentiment"],
              status: (issueData.status || "OPEN") as IssueWorkflowStatus,
              createdAt: issueData.createdAt
                ? new Date(issueData.createdAt).getTime()
                : Date.now(),
              checkedAt: issueData.checkedAt
                ? new Date(issueData.checkedAt).getTime()
                : undefined,
              processedAt: issueData.processedAt
                ? new Date(issueData.processedAt).getTime()
                : undefined,
              assignedAgentId:
                issueData.assignedAgentId || issueData.assignedTo || null,
              assignedAgentName: issueData.assignedAgentName || null,
              externalSource,
              cafeGameCode,
              gameName: issueData.gameName || gameName || null,
            } as Ticket;

            // 티켓 목록에 추가 (임시로, 다음 로드 시 정상적으로 로드됨)
            setTickets((prev) => {
              // 이미 존재하는지 확인
              if (prev.find((t) => t.issueId === issueId)) {
                return prev;
              }
              return [ticket!, ...prev];
            });
          }
        } catch (error) {
          logger.error("Failed to fetch issue for notification", {
            issueId,
            error,
          });
          // 이슈를 가져오지 못해도 사용자에게 알림
          alert(t("errors.issueNotFound", { id: issueId }));
          return;
        }
      }

      if (ticket) {
        handleSelectTicket(ticket);
        // 메인 뷰로 전환 (설정 페이지에 있을 수 있음)
        setCurrentView("main");
      } else {
        // 티켓을 찾지 못한 경우
        logger.warn("Ticket not found for issue", { issueId });
        alert(t("errors.issueNotFound", { id: issueId }));
      }
    };

    const eventHandler = handleSelectIssue as unknown as EventListener;
    window.addEventListener("selectIssue", eventHandler);
    return () => {
      window.removeEventListener("selectIssue", eventHandler);
    };
  }, [
    tickets,
    handleSelectTicket,
    token,
    authHeadersOrUndefined,
    withProjectParam,
    setTickets,
    t,
    crawlerLookups,
  ]);

  useEffect(() => {
    if (currentView !== "main") {
      return;
    }

    const controller = new AbortController();
    const loadAgents = async () => {
      setLoadingAgents(true);
      setAgentsLoadError(null);
      try {
        // selectedProjectId가 있으면 해당 프로젝트의 에이전트만, 없으면 전체 에이전트 로드
        const url = selectedProjectId
          ? `/api/agents?projectId=${selectedProjectId}`
          : "/api/agents";

        const res = await fetch(url, {
          headers: authHeaders,
          signal: controller.signal,
        });
        if (!res.ok) {
          const errorText = await res.text().catch(() => "");
          logger.warn("Failed to load agents", {
            status: res.status,
            statusText: res.statusText,
            errorText,
          });
          setAgentsLoadError(
            t("errors.agentsLoadStatus", { status: res.status }),
          );
          setLoadingAgents(false);
          return;
        }
        const body = await res.json();
        const agentsData =
          body?.success && Array.isArray(body.data)
            ? body.data
            : Array.isArray(body)
              ? body
              : [];

        logger.debug("Agents loaded", {
          count: agentsData.length,
          selectedProjectId,
        });

        if (selectedProjectId) {
          setProjectAgents(agentsData);
        } else {
          // projectId가 없으면 전체 에이전트를 projectAgents에도 설정하여 표시 가능하게 함
          setProjectAgents(agentsData);
          // agents도 업데이트 (WebSocket 데이터가 없을 때를 대비)
          if (agentsData.length > 0 && agents.length === 0) {
            setAgents(agentsData);
          }
        }
        setAgentsLoadError(null);
      } catch (error) {
        if ((error as any).name !== "AbortError") {
          logger.error("Agent fetch failed", { error });
          setAgentsLoadError(t("errors.agentsLoadGeneric"));
        }
      } finally {
        setLoadingAgents(false);
      }
    };

    if (token) {
      loadAgents();
    } else {
      setLoadingAgents(false);
    }
    return () => controller.abort();
  }, [currentView, selectedProjectId, authHeaders, token, t]);

  // 사용 가능한 게임 목록 로드 (MonitoredBoard에서)
  useEffect(() => {
    if (currentView !== "main") {
      return;
    }

    const loadAvailableGames = async () => {
      if (!token) return;
      try {
        const res = await fetch("/api/monitoring/boards", {
          headers: authHeaders,
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json();
          const boards = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data)
              ? data
              : [];
          // cafeGame 값들을 추출하고 중복 제거
          const games = Array.from(
            new Set<string>(
              boards
                .map((board: any) => board.cafeGame)
                .filter(
                  (game: unknown): game is string =>
                    typeof game === "string" && game.length > 0,
                ),
            ),
          );
          setAvailableGames(games);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("fetch") || msg.includes("Abort")) {
          logger.warn(
            "Available games load skipped (backend may be starting)",
            { error: msg },
          );
        } else {
          logger.error("Failed to load available games", { error });
        }
      }
    };
    loadAvailableGames();
  }, [token, authHeaders, currentView]);

  // filteredTickets, highPriorityTickets, normalTickets는 Context에서 제공됨
  // 1차: 검색어 기준 필터링 (클라이언트 사이드)
  const searchFilteredTickets = useMemo(() => {
    const trimmed = debouncedSearchQuery.trim();
    if (!trimmed) {
      return filteredTickets;
    }
    const q = trimmed.toLowerCase();
    return filteredTickets.filter((ticket) => {
      const fields: Array<string | undefined | null> = [
        ticket.title,
        (ticket as any).body,
        ticket.id,
        ticket.primaryCategory,
        Array.isArray(ticket.categories)
          ? ticket.categories.join(" ")
          : undefined,
        (ticket as any).assigneeName,
        (ticket as any).authorName,
      ];
      return fields.some(
        (value) => typeof value === "string" && value.toLowerCase().includes(q),
      );
    });
  }, [filteredTickets, debouncedSearchQuery]);

  // 2차: 날짜 필터링 적용 (사용자가 날짜를 지정한 경우에만, 클라이언트 사이드)
  const dateFilteredTickets = useMemo(() => {
    if (!dateFilter.startDate && !dateFilter.endDate) {
      return searchFilteredTickets; // 날짜 지정 안 했으면 날짜 필터 없이 검색 결과 전체 표시
    }
    const start = dateFilter.startDate;
    const end = dateFilter.endDate;
    return searchFilteredTickets.filter((ticket) => {
      const ticketDate =
        ticket.date ||
        (ticket.createdAt
          ? new Date(ticket.createdAt).toISOString().split("T")[0]
          : null);
      if (!ticketDate) return true;
      if (start && ticketDate < start) return false;
      if (end && ticketDate > end) return false;
      return true;
    });
  }, [searchFilteredTickets, dateFilter]);

  // 표시 그룹(게임·크롤러 프로필 라벨)별 이슈 그룹화
  const ticketsByGame = useMemo(() => {
    const grouped: Record<
      string,
      { highPriority: Ticket[]; normal: Ticket[] }
    > = {};
    const otherKey = t("ticketFallback.other");
    const sortLocale = i18n.language?.startsWith("ko") ? "ko" : "en";

    // 중요 이슈: Sev1만 표시 (완료되지 않은 것만)
    const dateFilteredHighPriority = dateFilteredTickets.filter((t) => {
      if (t.processedAt || t.status === "RESOLVED" || t.status === "VERIFIED")
        return false;
      if (t.severity !== 1) return false;
      return true;
    });

    // 중요 이슈 그룹화
    dateFilteredHighPriority.forEach((ticket) => {
      const gameName = ticket.gameName || otherKey;
      if (!grouped[gameName]) {
        grouped[gameName] = { highPriority: [], normal: [] };
      }
      grouped[gameName].highPriority.push(ticket);
    });

    // 전체 이슈 그룹화 (날짜 필터링된 티켓 사용 - 배포 버전과 동일)
    // showCompletedIssues가 false면 완료된 이슈 제외
    const ticketsForNormal = showCompletedIssues
      ? dateFilteredTickets
      : dateFilteredTickets.filter(
          (t) =>
            !t.processedAt &&
            !["RESOLVED", "VERIFIED", "CLOSED"].includes(t.status || ""),
        );
    ticketsForNormal.forEach((ticket) => {
      const gameName = ticket.gameName || otherKey;
      if (!grouped[gameName]) {
        grouped[gameName] = { highPriority: [], normal: [] };
      }
      grouped[gameName].normal.push(ticket);
    });

    return Object.entries(grouped)
      .sort(([a], [b]) => {
        if (a === otherKey) return 1;
        if (b === otherKey) return -1;
        return a.localeCompare(b, sortLocale);
      })
      .reduce(
        (acc, [gameName, tickets]) => {
          acc[gameName] = tickets;
          return acc;
        },
        {} as Record<string, { highPriority: Ticket[]; normal: Ticket[] }>,
      );
  }, [dateFilteredTickets, showCompletedIssues, t, i18n.language]);

  // 그룹별 통계 계산
  const gameStats = useMemo(() => {
    const stats: Record<string, { total: number; sev1: number; open: number }> =
      {};
    Object.entries(ticketsByGame).forEach(([gameName, { normal }]) => {
      // normal 배열에는 이미 모든 이슈(중요 이슈 포함)가 들어있으므로, normal을 기준으로 통계 계산
      const allTickets = normal; // normal이 전체 이슈를 나타냄
      stats[gameName] = {
        total: allTickets.length, // 전체 이슈 수 (중요 이슈 포함)
        sev1: allTickets.filter((t) => t.severity === 1).length,
        open: allTickets.filter((t) =>
          ["OPEN", "TRIAGED", "IN_PROGRESS"].includes(t.status),
        ).length,
      };
    });
    return stats;
  }, [ticketsByGame]);

  const getCurrentAgentId = useCallback(() => {
    if (typeof window === "undefined") return null;

    // 레거시: localStorage에서 agentId 가져오기
    const legacyAgentId = localStorage.getItem("agentId");
    if (legacyAgentId) {
      return legacyAgentId;
    }

    // 새로운 인증 시스템: User ID로 Agent 찾기
    if (user?.id && agents.length > 0) {
      // agents 배열에서 현재 사용자와 연결된 에이전트 찾기
      const userAgent = agents.find((agent) => agent.userId === user.id);
      if (userAgent) {
        return userAgent.id;
      }
    }

    return null;
  }, [user?.id, agents]);

  // 에이전트 로그인 시 미열람 공지 건수 (알림 뱃지용)
  const unreadNoticeCountForCurrentAgent = useMemo(() => {
    const currentAgentId =
      getCurrentAgentId() ||
      projectAgents.find((a) => a.name === user?.name)?.id;
    if (!user) return 0;
    const idStr = currentAgentId != null ? String(currentAgentId) : null;
    const nameMatch = user?.name;
    return feedbackNotices.filter((n) => {
      const unread = n.unreadAgents || [];
      if (idStr && unread.some((ua) => String(ua.id) === idStr)) return true;
      if (nameMatch && unread.some((ua) => ua.name === nameMatch)) return true;
      return false;
    }).length;
  }, [getCurrentAgentId, projectAgents, user?.name, user, feedbackNotices]);

  // 카드 아이템 렌더링 함수 (컴포넌트 사용)
  const renderCardItem = (ticket: Ticket) => {
    return (
      <TicketCardItem
        key={ticket.id}
        ticket={ticket}
        projectAgents={projectAgents}
        agents={agents}
        token={token}
        selectedTicketIds={selectedTicketIds}
        getCurrentAgentId={getCurrentAgentId}
        handleSelectTicket={handleSelectTicket}
        toggleTicketSelection={toggleTicketSelection}
        setTickets={setTickets}
        setSelectedTicketIds={setSelectedTicketIds}
        withProjectParam={withProjectParam}
        authHeadersOrUndefined={authHeadersOrUndefined}
      />
    );
  };

  // 메트릭 데이터 계산 (tickets 배열에서)
  const metricsData = useMemo(() => {
    const totalIssues = tickets.length;

    // 상태별 집계
    const statusMap: Record<string, number> = {};
    tickets.forEach((ticket) => {
      const status = ticket.status || "OPEN";
      statusMap[status] = (statusMap[status] || 0) + 1;
    });
    const issuesByStatus = Object.entries(statusMap).map(([status, count]) => ({
      status,
      count,
    }));

    // 오늘 생성된 이슈 수 계산
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();
    const tomorrowTimestamp = todayTimestamp + 24 * 60 * 60 * 1000;
    const todayCount = tickets.filter(
      (ticket) =>
        ticket.createdAt >= todayTimestamp &&
        ticket.createdAt < tomorrowTimestamp,
    ).length;

    return {
      totalIssues,
      issuesByStatus,
      todayCount,
    };
  }, [tickets]);

  // 상단 바는 항상 표시. 로고 클릭 → 메인, 메뉴로 화면 이동.
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/20 text-slate-800 p-4 md:p-6">
      <div className="flex flex-col gap-4 mb-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="flex items-end gap-4">
            <div>
              <button
                type="button"
                onClick={() => setCurrentView("main")}
                className="text-left hover:opacity-90 transition-opacity ui-focus-ring rounded-lg"
              >
                <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  {t("header.title")}
                </h1>
              </button>
              <p className="text-sm text-slate-600 font-medium">
                {t("header.subtitle")}
              </p>
              {selectedProject && (
                <p className="text-xs text-slate-400 mt-1">
                  {t("header.currentProject", { name: selectedProject.name })}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <ProjectSelector />
            {/* 메뉴 (별도 메뉴 UI) */}
            <div className="relative" ref={menuRef}>
              <Button
                onClick={() => setMenuOpen((o) => !o)}
                variant="outline"
                className="bg-slate-700 text-white hover:bg-slate-600 border-slate-700"
              >
                <span>☰</span>
                <span>{t("header.menu")}</span>
              </Button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[260px] max-h-[min(85vh,640px)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-lg">
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("menu.monitoringGroupedTitle")}
                  </div>
                  <div className="space-y-3 px-1 pb-2">
                    <div>
                      <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {t("menu.sectionCommon")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("main");
                          setFilter((f) => ({ ...f, src: "all" }));
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>📊</span>
                        <span>{t("menu.issuesAll")}</span>
                      </button>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 py-1">
                      <div className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                        {t("menu.sectionNaverCafe")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("main");
                          setFilter((f) => ({ ...f, src: "naver" }));
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-emerald-100/60 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>🟢</span>
                        <span>{t("menu.issuesNaver")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowManualIngestModal(true);
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-emerald-100/60 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>➕</span>
                        <span>{t("header.manualIngest")}</span>
                      </button>
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-violet-50/40 py-1">
                      <div className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-violet-900">
                        {t("menu.sectionInZOI")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("main");
                          setFilter((f) => ({ ...f, src: "discord" }));
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-100/60 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>💬</span>
                        <span>{t("menu.issuesDiscord")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("main");
                          setFilter((f) => ({ ...f, src: "system" }));
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-100/60 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>⚙️</span>
                        <span>{t("menu.issuesSystem")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("forumMonitoring");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-100/60 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>🧭</span>
                        <span>{t("menu.forumMonitoring")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("inzoiStandaloneAlerts");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-100/60 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>🧾</span>
                        <span>{t("menu.inzoiStandaloneAlerts")}</span>
                      </button>
                    </div>
                  </div>
                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t("menu.sectionWork")}
                  </div>
                  <button
                    onClick={() => {
                      setCurrentView("workChecklist");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                  >
                    <span>✅</span>
                    <span>{t("menu.workChecklist")}</span>
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView("handover");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                  >
                    <span>📋</span>
                    <span>{t("menu.handover")}</span>
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t("menu.sectionRef")}
                  </div>
                  <button
                    onClick={() => {
                      setCurrentView("assistant");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                  >
                    <AiBotIcon className="h-4 w-4 shrink-0 opacity-90" />
                    <span>{t("menu.aiAssistant")}</span>
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView("notices");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                  >
                    <span>📢</span>
                    <span>{t("menu.notices")}</span>
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView("notificationSettings");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                  >
                    <span>🔔</span>
                    <span>{t("menu.notificationSettings")}</span>
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView("calendar");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                  >
                    <span>📅</span>
                    <span>{t("menu.calendar")}</span>
                  </button>
                  {(user?.role === "ADMIN" ||
                    user?.role === "LEAD" ||
                    user?.role === "SUPERADMIN") && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t("menu.sectionAdmin")}
                      </div>
                      <button
                        onClick={() => {
                          setCurrentView("workChecklistManagement");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>✅</span>
                        <span>{t("menu.workChecklistMgmt")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setCurrentView("stepFloatingManagement");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>📌</span>
                        <span>{t("menu.stepFloatingMgmt")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setCurrentView("workGuideManagement");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>📚</span>
                        <span>{t("menu.guideMgmt")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setCurrentView("workNotificationManagement");
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                      >
                        <span>🔔</span>
                        <span>{t("menu.workNotificationMgmt")}</span>
                      </button>
                    </>
                  )}
                  {(user?.role === "ADMIN" ||
                    user?.role === "LEAD" ||
                    user?.role === "SUPERADMIN" ||
                    user?.role === "AGENT") && (
                    <button
                      onClick={() => {
                        setCurrentView("commentWatchManagement");
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ui-focus-ring rounded-lg mx-1"
                    >
                      <span>💬</span>
                      <span>{t("menu.commentWatch")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <Button
              onClick={() => setShowManualIngestModal(true)}
              variant="primary"
              className="shadow-medium"
            >
              <span>➕</span>
              <span>{t("header.manualIngest")}</span>
            </Button>
            {/* WebSocket 실시간 연결 상태 */}
            <WebSocketStatusBadge
              connected={wsConnected}
              error={wsError}
              onReconnect={wsReconnect}
            />
            <button
              type="button"
              onClick={() => setCurrentView("assistant")}
              className={`flex h-10 w-10 items-center justify-center rounded-xl glass-effect shadow-soft text-slate-600 transition-all hover:bg-white/60 hover:text-violet-600 ${
                currentView === "assistant"
                  ? "text-violet-600 ring-2 ring-violet-400/70 ring-offset-2 ring-offset-transparent"
                  : ""
              }`}
              title={t("header.aiAssistantTitle")}
            >
              <AiBotIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                window.history.pushState(null, "", "/calendar");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl glass-effect shadow-soft text-slate-600 transition-all hover:bg-white/60 hover:text-blue-600"
              title={t("header.calendarTitle")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </button>
            <div className="text-sm text-slate-600 flex items-center gap-3 glass-effect rounded-xl px-4 py-2 shadow-soft">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  {t("header.loginAccount")}
                </div>
                <div className="font-semibold text-slate-700">
                  {user?.name || user?.email}
                </div>
                <div className="text-xs text-slate-400">
                  {user?.role || "UNKNOWN"}
                </div>
              </div>
              <button
                onClick={logout}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 underline-offset-2 underline"
              >
                {t("header.logout")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {currentView === "main" ? (
        <>
          <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-3 shadow-sm backdrop-blur-sm md:px-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("menu.monitoringGroupedTitle")}
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {t("menu.sectionCommon")}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentView("main");
                      setFilter((f) => ({ ...f, src: "all" }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all ui-focus-ring ${
                      currentView === "main" &&
                      (!filter.src || filter.src === "all")
                        ? "border-slate-500 bg-slate-100 text-slate-900 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {t("menu.issuesAll")}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/35 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-900">
                  {t("menu.sectionNaverCafe")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentView("main");
                      setFilter((f) => ({ ...f, src: "naver" }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all ui-focus-ring ${
                      currentView === "main" && filter.src === "naver"
                        ? "border-emerald-500 bg-emerald-100 text-emerald-950 shadow-sm"
                        : "border-emerald-200/80 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/80"
                    }`}
                  >
                    {t("menu.issuesNaver")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualIngestModal(true)}
                    className="rounded-xl border border-emerald-200/80 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-emerald-400 hover:bg-emerald-50/80 ui-focus-ring"
                  >
                    ➕ {t("header.manualIngest")}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-violet-100 bg-violet-50/35 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-violet-950">
                  {t("menu.sectionInZOI")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentView("main");
                      setFilter((f) => ({ ...f, src: "discord" }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all ui-focus-ring ${
                      currentView === "main" && filter.src === "discord"
                        ? "border-violet-500 bg-violet-100 text-violet-950 shadow-sm"
                        : "border-violet-200/80 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/80"
                    }`}
                  >
                    {t("menu.issuesDiscord")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentView("main");
                      setFilter((f) => ({ ...f, src: "system" }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all ui-focus-ring ${
                      currentView === "main" && filter.src === "system"
                        ? "border-violet-500 bg-violet-100 text-violet-950 shadow-sm"
                        : "border-violet-200/80 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/80"
                    }`}
                  >
                    {t("menu.issuesSystem")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentView("forumMonitoring")}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all ui-focus-ring ${
                      currentView === "forumMonitoring"
                        ? "border-violet-500 bg-violet-100 text-violet-950 shadow-sm"
                        : "border-violet-200/80 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/80"
                    }`}
                  >
                    🧭 {t("menu.forumMonitoring")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentView("inzoiStandaloneAlerts")}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all ui-focus-ring ${
                      currentView === "inzoiStandaloneAlerts"
                        ? "border-violet-500 bg-violet-100 text-violet-950 shadow-sm"
                        : "border-violet-200/80 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/80"
                    }`}
                  >
                    🧾 {t("menu.inzoiStandaloneAlerts")}
                  </button>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {t("monitoringTabs.platformHint")}
            </p>
          </div>

          {/* 업무 시작 전 바로가기 버튼 */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => setCurrentView("notices")}
              className="relative flex min-h-[88px] items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-6 py-5 text-left shadow-md transition-all hover:border-blue-300 hover:bg-blue-50/80 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {unreadNoticeCountForCurrentAgent > 0 && (
                <span
                  className="absolute right-3 top-3 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white"
                  title={t("shortcuts.unreadNoticesTitle")}
                >
                  {unreadNoticeCountForCurrentAgent > 99
                    ? "99+"
                    : unreadNoticeCountForCurrentAgent}
                </span>
              )}
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-2xl">
                📢
              </span>
              <span className="text-lg font-semibold text-slate-800">
                {t("shortcuts.beforeWorkNotices")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentView("workChecklist")}
              className="flex min-h-[88px] items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-6 py-5 text-left shadow-md transition-all hover:border-blue-300 hover:bg-blue-50/80 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-100 text-2xl">
                ✅
              </span>
              <span className="text-lg font-semibold text-slate-800">
                {t("shortcuts.workChecklist")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentView("handover")}
              className="flex min-h-[88px] items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-6 py-5 text-left shadow-md transition-all hover:border-blue-300 hover:bg-blue-50/80 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-2xl">
                📋
              </span>
              <span className="text-lg font-semibold text-slate-800">
                {t("shortcuts.handover")}
              </span>
            </button>
          </div>

          {/* 상단 섹션 (검색, 필터, 에이전트 상태, 메트릭) - 접기/펼치기 가능 */}
          <div className="mb-4 glass-effect rounded-2xl shadow-medium overflow-hidden backdrop-blur-sm">
            {/* 헤더 - 토글 버튼 */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/50 transition-all duration-200 rounded-t-2xl"
              onClick={() => setIsTopSectionExpanded(!isTopSectionExpanded)}
            >
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  {t("filters.sectionTitle")}
                </h2>
                {/* 완료된 이슈 표시 토글 - 헤더에 표시 */}
                <label
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={showCompletedIssues}
                    onChange={(e) => setShowCompletedIssues(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-xs font-medium text-slate-600">
                    {t("filters.showCompleted")}
                  </span>
                </label>
              </div>
              <button
                className="text-slate-500 hover:text-slate-700 transition-transform"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsTopSectionExpanded(!isTopSectionExpanded);
                }}
                title={
                  isTopSectionExpanded
                    ? t("filters.collapse")
                    : t("filters.expand")
                }
              >
                <span
                  className={`inline-block transition-transform duration-200 ${isTopSectionExpanded ? "rotate-180" : ""}`}
                >
                  ▼
                </span>
              </button>
            </div>

            {/* 컨텐츠 - 접기/펼치기 */}
            <div
              className={`transition-all duration-300 ease-in-out ${isTopSectionExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}
            >
              <div className="px-3 pb-3 space-y-4">
                {/* 검색 입력창 */}
                <div>
                  <label className="text-xs font-medium text-slate-500 flex flex-col gap-1">
                    {t("filters.issueSearch")}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={t("filters.searchPlaceholder")}
                        value={searchQuery}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setSearchQuery(e.target.value)
                        }
                        className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 bg-white/80 backdrop-blur-sm text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          title={t("filters.clearSearch")}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </label>
                </div>

                {/* 필터 (플랫폼/수집 소스는 상단 채널 탭에서 선택) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-slate-500 flex flex-col gap-1">
                    {t("filters.channel")}
                    <select
                      className="border-2 border-slate-200 rounded-xl px-3 py-2.5 bg-white/80 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                      value={filter.game || "all"}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        setFilter((f) => ({
                          ...f,
                          game: e.target.value as any,
                        }))
                      }
                    >
                      <option value="all">{t("filters.allChannels")}</option>
                      {availableGames.length > 0 &&
                        availableGames.map((game) => (
                          <option key={game} value={game}>
                            {crawlerLookups.labelByCode[game] ?? game}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-500 flex flex-col gap-1">
                    {t("filters.severity")}
                    <select
                      className="border rounded-md px-3 py-2 bg-white text-sm"
                      value={filter.sev}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        setFilter((f) => ({
                          ...f,
                          sev: (e.target.value === "all"
                            ? "all"
                            : Number(e.target.value)) as any,
                        }))
                      }
                    >
                      <option value="all">{t("filters.allSeverities")}</option>
                      <option value={1}>Sev1</option>
                      <option value={2}>Sev2</option>
                      <option value={3}>Sev3</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-500 flex flex-col gap-1">
                    {t("filters.category")}
                    <select
                      className="border rounded-md px-3 py-2 bg-white text-sm"
                      value={filter.cat || "all"}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        setFilter((f) => ({ ...f, cat: e.target.value as any }))
                      }
                    >
                      <option value="all">{t("filters.allCategories")}</option>
                      <option value="장애/접속">
                        {t("filters.catOutage")}
                      </option>
                      <option value="결제/환불">
                        {t("filters.catPayment")}
                      </option>
                      <option value="핵/부정행위">
                        {t("filters.catCheat")}
                      </option>
                      <option value="운영/정책">
                        {t("filters.catPolicy")}
                      </option>
                      <option value="불만/이탈징후">
                        {t("filters.catChurn")}
                      </option>
                    </select>
                  </label>
                </div>

                {/* 날짜 필터 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-slate-500 flex flex-col gap-1">
                    {t("filters.startDate")}
                    <LocalizedDateInput
                      type="date"
                      className="border-2 border-slate-200 rounded-xl px-3 py-2.5 bg-white/80 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                      value={dateFilter.startDate || ""}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const newDate = e.target.value || undefined;
                        console.log("[App] 시작일 변경:", newDate);
                        setDateFilter((f) => ({ ...f, startDate: newDate }));
                      }}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-500 flex flex-col gap-1">
                    {t("filters.endDate")}
                    <LocalizedDateInput
                      type="date"
                      className="border-2 border-slate-200 rounded-xl px-3 py-2.5 bg-white/80 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                      value={dateFilter.endDate || ""}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const newDate = e.target.value || undefined;
                        console.log("[App] 종료일 변경:", newDate);
                        setDateFilter((f) => ({ ...f, endDate: newDate }));
                      }}
                    />
                  </label>
                </div>
                {(dateFilter.startDate || dateFilter.endDate) && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDateFilter({})}
                      className="text-xs text-blue-600 hover:text-blue-700 underline"
                    >
                      {t("filters.resetDateFilter")}
                    </button>
                    <span className="text-xs text-slate-500">
                      {dateFilter.startDate && dateFilter.endDate
                        ? `${dateFilter.startDate} ~ ${dateFilter.endDate}`
                        : dateFilter.startDate
                          ? t("filters.afterDate", {
                              date: dateFilter.startDate,
                            })
                          : t("filters.beforeDate", {
                              date: dateFilter.endDate ?? "",
                            })}
                    </span>
                  </div>
                )}

                {/* 전체 필터 초기화 - 검색/필터가 하나라도 적용된 경우 표시 */}
                {(searchQuery ||
                  dateFilter.startDate ||
                  dateFilter.endDate ||
                  (filter.game && filter.game !== "all") ||
                  (filter.src && filter.src !== "all") ||
                  (filter.sev && filter.sev !== "all") ||
                  (filter.cat && filter.cat !== "all")) && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setDateFilter({});
                        setFilter({
                          src: "all",
                          sev: "all",
                          cat: "all",
                          game: "all",
                        });
                        setShowCompletedIssues(true);
                        saveFiltersToStorage({
                          searchQuery: "",
                          dateFilter: {},
                          filter: {
                            src: "all",
                            sev: "all",
                            cat: "all",
                            game: "all",
                          },
                          showCompletedIssues: true,
                        });
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700 underline"
                    >
                      {t("filters.resetAllFilters")}
                    </button>
                  </div>
                )}

                {/* 완료된 이슈 표시 토글 */}
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCompletedIssues}
                      onChange={(e) => setShowCompletedIssues(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      {t("filters.showCompleted")}
                    </span>
                  </label>
                  <span className="text-xs text-slate-500">
                    (
                    {showCompletedIssues
                      ? t("filters.completedHintInclude")
                      : t("filters.completedHintOpenOnly")}
                    )
                  </span>
                </div>
                {selectedTicketIds.size > 0 && (
                  <>
                    <span className="text-sm text-slate-600 ml-2">
                      {t("filters.selectedCount", {
                        count: selectedTicketIds.size,
                      })}
                    </span>
                    <button
                      className="px-4 py-2 text-sm bg-slate-100 rounded-xl hover:bg-slate-200 transition-all font-medium shadow-sm"
                      onClick={clearSelection}
                    >
                      {t("filters.clearSelection")}
                    </button>
                  </>
                )}

                {/* 에이전트 상태 섹션 */}
                <AgentStatusSection
                  agents={agents}
                  projectAgents={projectAgents}
                  currentAgentId={getCurrentAgentId()}
                  loadingAgents={loadingAgents}
                  agentsLoadError={agentsLoadError}
                />

                {/* 메트릭 카드 */}
                <MetricsCards
                  dateFilteredTickets={dateFilteredTickets}
                  agents={agents}
                  metricsData={metricsData}
                />
              </div>
            </div>
          </div>

          {dataError && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {t("data.loadError", { message: dataError })}
            </div>
          )}

          {dataLoading && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {t("data.loading")}
            </div>
          )}

          {/* 고객사 피드백 공지 - 상단 배치 */}
          <div className="mb-6 bg-white rounded-2xl shadow-sm border p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {t("notices.sectionTitle")}
              </h2>
              <div className="flex items-center gap-2">
                <>
                  {(user?.role === "ADMIN" ||
                    user?.role === "LEAD" ||
                    user?.role === "SUPERADMIN") && (
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                        <span className="text-slate-500">👤</span>
                        <span>{t("notices.slackAccountLabel")}</span>
                      </label>
                      <div className="relative">
                        <select
                          multiple
                          value={selectedSlackNoticeUserIds}
                          onChange={(e) => {
                            const values = Array.from(
                              e.target.selectedOptions,
                            ).map((o) => o.value);
                            setSelectedSlackNoticeUserIds(values);
                            setManualSlackNoticeUserIds(values.join(","));
                          }}
                          className="min-w-[240px] max-w-[360px] h-[32px] max-h-[32px] px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white shadow-sm hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer overflow-y-auto"
                          size={1}
                          title={t("notices.slackSelectTitle")}
                        >
                          {slackUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.displayName || u.name || u.id}
                            </option>
                          ))}
                        </select>
                        {selectedSlackNoticeUserIds.length > 0 && (
                          <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                            {selectedSlackNoticeUserIds.length}
                          </span>
                        )}
                      </div>
                      {slackUsers.length === 0 && (
                        <div className="flex flex-col gap-1.5">
                          <div className="relative">
                            <input
                              value={manualSlackNoticeUserIds}
                              onChange={(e) => {
                                setManualSlackNoticeUserIds(e.target.value);
                                const ids = e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean);
                                setSelectedSlackNoticeUserIds(ids);
                              }}
                              placeholder={t("notices.slackManualPlaceholder")}
                              className="w-[280px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white shadow-sm hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                              title={t("notices.slackManualTitle")}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                              🔑
                            </span>
                          </div>
                          {slackUsersLoadError && (
                            <div className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                              ⚠️ {slackUsersLoadError}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {(user?.role === "ADMIN" || user?.role === "LEAD") && (
                    <button
                      onClick={() => {
                        if (showNoticeForm) closeNoticeEditor();
                        else {
                          setEditingNotice(null);
                          setShowNoticeForm(true);
                        }
                      }}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {showNoticeForm
                        ? t("notices.cancel")
                        : t("notices.compose")}
                    </button>
                  )}
                  <button
                    onClick={handleTriggerSlackNoticeCollection}
                    disabled={triggeringSlackNotice}
                    className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    title={t("notices.slackCollectTitle")}
                  >
                    {triggeringSlackNotice ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        <span>{t("notices.collecting")}</span>
                      </>
                    ) : (
                      <>
                        <span>🔄</span>
                        <span>{t("notices.slackCollect")}</span>
                      </>
                    )}
                  </button>
                </>
              </div>
            </div>

            {/* 공지 작성/수정 폼 (별도 컴포넌트로 분리해 입력 지연 완화) */}
            {showNoticeForm &&
              (user?.role === "ADMIN" || user?.role === "LEAD") && (
                <div ref={noticeEditorRef}>
                  <NoticeEditor
                    editingNotice={editingNotice}
                    availableGames={availableGames}
                    gameLabelByCode={crawlerLookups.labelByCode}
                    submitting={submittingNotice}
                    onCancel={closeNoticeEditor}
                    onSave={handleSaveNotice}
                    onEnd={handleEndNotice}
                  />
                </div>
              )}

            {/* 공지 목록 — 공통 공지 상단, 게임명 키워드로 자동 분류(A/B) */}
            {loadingNotices ? (
              <div className="text-center py-4 text-slate-500 text-sm">
                {t("notices.loading")}
              </div>
            ) : feedbackNotices.length === 0 ? (
              <div className="text-center py-4 text-slate-400 text-sm">
                {t("notices.empty")}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {(() => {
                  const isDesktopNotice = (name?: string | null) =>
                    /pubg\s*pc|데스크톱|desktop|공식\s*pc/i.test(
                      String(name || ""),
                    );
                  const isMobileNotice = (name?: string | null) => {
                    const s = String(name || "");
                    if (isDesktopNotice(s)) return false;
                    return /pubgm|pubg\s*mobile|모바일|\bmobile\b/i.test(s);
                  };
                  const pcNotices = sortFeedbackNoticesEndedLast(
                    feedbackNotices.filter((n) => isDesktopNotice(n.gameName)),
                  ).slice(0, 10);
                  const pubgmNotices = sortFeedbackNoticesEndedLast(
                    feedbackNotices.filter((n) => isMobileNotice(n.gameName)),
                  ).slice(0, 10);
                  const otherNotices = sortFeedbackNoticesEndedLast(
                    feedbackNotices.filter(
                      (n) =>
                        !isDesktopNotice(n.gameName) &&
                        !isMobileNotice(n.gameName),
                    ),
                  ).slice(0, 6);

                  const renderNotice = (notice: CustomerFeedbackNotice) => {
                    const currentAgentId = getCurrentAgentId();
                    const isReadByMe =
                      (currentAgentId != null &&
                        (notice.readAgents || []).some(
                          (r) => String(r.id) === String(currentAgentId),
                        )) ||
                      (user?.name &&
                        (notice.readAgents || []).some(
                          (r) => r.name === user.name,
                        ));
                    const isEnded = !!(notice.endedAt && notice.endedAt.trim());
                    const displayDate = (() => {
                      const createdAt = new Date(notice.createdAt);
                      const updatedAt = new Date(notice.updatedAt);
                      const isModified =
                        updatedAt.getTime() > createdAt.getTime() + 1000;
                      const d = isModified ? updatedAt : createdAt;
                      return d.toLocaleString(dateLocale, {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Seoul",
                      });
                    })();
                    return (
                      <li
                        key={notice.id}
                        className={`p-4 rounded-xl border transition-colors cursor-pointer ${
                          isReadByMe
                            ? "bg-white border-slate-200 hover:bg-slate-50"
                            : "bg-rose-50/90 border-rose-100 hover:bg-rose-100/80"
                        }`}
                        onClick={() => handleNoticeClick(notice)}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                            <span className="px-2.5 py-1 text-xs font-semibold bg-blue-500 text-white rounded-full whitespace-nowrap">
                              {notice.gameName}
                            </span>
                            <span
                              className={`text-sm font-bold text-slate-900 flex-1 min-w-0 ${isEnded ? "line-through text-slate-500" : ""}`}
                            >
                              {notice.title?.trim() ||
                                t("notices.defaultTitle")}
                            </span>
                            <span className="text-xs text-slate-400 whitespace-nowrap shrink-0 inline-flex items-center min-h-[2.25rem]">
                              {displayDate}
                            </span>
                            {notice.url != null &&
                              String(notice.url).trim() !== "" && (
                                <a
                                  href={(() => {
                                    const u = String(notice.url).trim();
                                    return u.startsWith("http://") ||
                                      u.startsWith("https://")
                                      ? u
                                      : `https://${u}`;
                                  })()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="shrink-0 inline-flex items-center justify-center min-h-[2.25rem] px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 border border-blue-200 whitespace-nowrap"
                                  title={String(notice.url).trim()}
                                >
                                  {t("notices.link")}
                                </a>
                              )}
                          </div>
                          {(user?.role === "ADMIN" ||
                            user?.role === "LEAD") && (
                            <div
                              className="flex items-center gap-1.5 text-xs shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="inline-flex items-center justify-center min-h-[2.25rem] px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-blue-600 hover:bg-blue-50"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleEditNotice(notice);
                                }}
                              >
                                {t("notices.edit")}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center min-h-[2.25rem] px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteNotice(notice.id);
                                }}
                              >
                                {t("notices.delete")}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="px-2.5 py-1 text-xs font-semibold bg-amber-200 text-amber-900 rounded-full whitespace-nowrap">
                            {notice.category || "—"}
                          </span>
                          <span
                            className={`text-sm text-slate-700 flex-1 min-w-0 ${isEnded ? "line-through text-slate-500" : ""}`}
                          >
                            {notice.content.length > 80
                              ? notice.content.substring(0, 80) + "..."
                              : notice.content}
                          </span>
                          {notice.managerName && (
                            <span className="text-xs font-medium text-purple-600 whitespace-nowrap">
                              {t("notices.author", {
                                name: notice.managerName,
                              })}
                            </span>
                          )}
                        </div>
                        {isEnded && notice.endedAt && (
                          <div className="mt-2 text-xs text-slate-500">
                            {t("notices.endedAt", {
                              date: new Date(notice.endedAt).toLocaleString(
                                dateLocale,
                                {
                                  timeZone: "Asia/Seoul",
                                  dateStyle: "short",
                                  timeStyle: "short",
                                },
                              ),
                            })}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {(user?.role === "ADMIN" ||
                            user?.role === "LEAD" ||
                            user?.role === "SUPERADMIN") && (
                            <>
                              {(notice.readAgents?.length || 0) > 0 && (
                                <span className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-emerald-600 font-medium">
                                    {t("notices.readBy")}
                                  </span>
                                  {(notice.readAgents || [])
                                    .slice(0, 3)
                                    .map((a) => (
                                      <span
                                        key={a.id}
                                        className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      >
                                        {a.name}
                                      </span>
                                    ))}
                                  {(notice.readAgents?.length || 0) > 3 && (
                                    <span className="text-slate-500">
                                      {t("notices.peopleMore", {
                                        count:
                                          (notice.readAgents?.length || 0) - 3,
                                      })}
                                    </span>
                                  )}
                                </span>
                              )}
                              {(notice.unreadAgents?.length || 0) > 0 && (
                                <span className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-amber-600 font-medium">
                                    {t("notices.unreadBy")}
                                  </span>
                                  {(notice.unreadAgents || [])
                                    .slice(0, 3)
                                    .map((a) => (
                                      <span
                                        key={a.id}
                                        className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                                      >
                                        {a.name}
                                      </span>
                                    ))}
                                  {(notice.unreadAgents?.length || 0) > 3 && (
                                    <span className="text-slate-500">
                                      {t("notices.peopleMore", {
                                        count:
                                          (notice.unreadAgents?.length || 0) -
                                          3,
                                      })}
                                    </span>
                                  )}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        {notice.screenshotPath && (
                          <div className="mt-2">
                            <NoticeScreenshotImage
                              screenshotPath={notice.screenshotPath}
                            />
                          </div>
                        )}
                      </li>
                    );
                  };

                  const Column = (props: {
                    title: string;
                    items: CustomerFeedbackNotice[];
                  }) => (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                        <div className="text-sm font-semibold text-slate-800">
                          {props.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {t("notices.columnCount", {
                            count: props.items.length,
                          })}
                        </div>
                      </div>
                      <div className="p-2">
                        {props.items.length === 0 ? (
                          <div className="text-center py-6 text-slate-400 text-sm">
                            {t("notices.noNoticesInColumn")}
                          </div>
                        ) : (
                          <ul className="space-y-2 max-h-[520px] overflow-auto pr-1">
                            {props.items.map(renderNotice)}
                          </ul>
                        )}
                      </div>
                    </div>
                  );

                  return (
                    <>
                      {otherNotices.length > 0 && (
                        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                            <div className="text-sm font-semibold text-slate-800">
                              {t("notices.common")}
                            </div>
                            <div className="text-xs text-slate-500">
                              {t("notices.columnCount", {
                                count: otherNotices.length,
                              })}
                            </div>
                          </div>
                          <div className="p-2">
                            <ul className="space-y-2">
                              {otherNotices.map(renderNotice)}
                            </ul>
                          </div>
                        </div>
                      )}
                      <Column title={t("notices.classA")} items={pcNotices} />
                      <Column
                        title={t("notices.classB")}
                        items={pubgmNotices}
                      />
                    </>
                  );
                })()}
              </div>
            )}

            {/* 공지 상세 팝업 */}
            {selectedNotice && (
              <div
                className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                onClick={() => setSelectedNotice(null)}
              >
                <div
                  className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-xl font-semibold">
                        {t("notices.detailTitle")}
                      </h3>
                      <button
                        onClick={() => setSelectedNotice(null)}
                        className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                      >
                        ×
                      </button>
                    </div>

                    <div className="space-y-4">
                      {selectedNotice.title?.trim() && (
                        <h4
                          className={`text-lg font-semibold text-slate-800 ${selectedNotice.endedAt ? "line-through text-slate-500" : ""}`}
                        >
                          {selectedNotice.title.trim()}
                        </h4>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                          {selectedNotice.gameName}
                        </span>
                        <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-700 rounded-full">
                          {selectedNotice.managerName}
                        </span>
                        <span className="px-2 py-1 text-xs font-semibold bg-purple-100 text-purple-700 rounded-full">
                          {selectedNotice.category}
                        </span>
                        <span className="px-2 py-1 text-xs text-slate-500">
                          {new Date(selectedNotice.noticeDate).toLocaleString(
                            dateLocale,
                            { timeZone: "Asia/Seoul" },
                          )}
                        </span>
                        {selectedNotice.endedAt && (
                          <span className="px-2 py-1 text-xs text-slate-500">
                            {t("notices.endedLabel")}{" "}
                            {new Date(selectedNotice.endedAt).toLocaleString(
                              dateLocale,
                              { timeZone: "Asia/Seoul" },
                            )}
                          </span>
                        )}
                        {selectedNotice.url != null &&
                          String(selectedNotice.url).trim() !== "" && (
                            <a
                              href={
                                selectedNotice.url
                                  .trim()
                                  .startsWith("http://") ||
                                selectedNotice.url.trim().startsWith("https://")
                                  ? selectedNotice.url.trim()
                                  : `https://${selectedNotice.url.trim()}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors flex items-center gap-1"
                              title={selectedNotice.url}
                            >
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                              </svg>
                              {t("notices.link")}
                            </a>
                          )}
                        {selectedNotice.slackChannelId &&
                          (() => {
                            // 슬랙 채널 링크 생성
                            // 채널 ID가 C로 시작하지 않으면 추가
                            const channelId =
                              selectedNotice.slackChannelId.startsWith("C")
                                ? selectedNotice.slackChannelId
                                : `C${selectedNotice.slackChannelId}`;

                            // teamId가 있으면 정확한 링크 생성, 없으면 일반 링크
                            let slackChannelLink;
                            if (selectedNotice.slackTeamId) {
                              // teamId가 있으면 정확한 채널 링크 생성
                              // 형식: https://app.slack.com/client/{teamId}/{channelId}
                              slackChannelLink = `https://app.slack.com/client/${selectedNotice.slackTeamId}/${channelId}`;
                            } else {
                              // teamId가 없으면 Deep Link 사용 (앱에서 열림)
                              // 형식: slack://channel?id={channelId}
                              slackChannelLink = `slack://channel?id=${channelId}`;
                            }

                            return (
                              <a
                                href={slackChannelLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="px-2 py-1 text-xs font-semibold bg-slate-100 text-slate-700 rounded-full hover:bg-slate-200 transition-colors flex items-center gap-1"
                                title={t("notices.openSlackChannel")}
                              >
                                <svg
                                  className="w-3 h-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                  />
                                </svg>
                                {t("notices.slackChannel")}
                              </a>
                            );
                          })()}
                      </div>

                      {selectedNotice.screenshotPath && (
                        <div className="mt-4">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                            {t("notices.image")}
                          </span>
                          <NoticeScreenshotImage
                            screenshotPath={selectedNotice.screenshotPath}
                          />
                        </div>
                      )}

                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">
                          {(() => {
                            // URL을 링크로 변환하는 함수
                            const text = selectedNotice.content;
                            const urlRegex = /(https?:\/\/[^\s]+)/g;
                            const parts: (string | JSX.Element)[] = [];
                            let lastIndex = 0;
                            let match;

                            // 정규식으로 URL 찾기
                            while ((match = urlRegex.exec(text)) !== null) {
                              // URL 이전 텍스트 추가
                              if (match.index > lastIndex) {
                                parts.push(
                                  text.substring(lastIndex, match.index),
                                );
                              }
                              // URL을 링크로 변환
                              const url = match[0];
                              parts.push(
                                <a
                                  key={match.index}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 underline break-all"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {url}
                                </a>,
                              );
                              lastIndex = match.index + url.length;
                            }

                            // 마지막 URL 이후 텍스트 추가
                            if (lastIndex < text.length) {
                              parts.push(text.substring(lastIndex));
                            }

                            // URL이 없으면 원본 텍스트 반환
                            return parts.length > 0 ? parts : text;
                          })()}
                        </p>
                      </div>

                      {/* 관리자만: 열람/미열람 에이전트 */}
                      {(user?.role === "ADMIN" ||
                        user?.role === "LEAD" ||
                        user?.role === "SUPERADMIN") && (
                        <>
                          <div>
                            <h4 className="text-sm font-semibold text-emerald-700 mb-2">
                              {t("notices.readAgentsTitle", {
                                count: selectedNotice.readAgents?.length || 0,
                              })}
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                              {selectedNotice.readAgents &&
                              selectedNotice.readAgents.length > 0 ? (
                                selectedNotice.readAgents.map((agent) => (
                                  <div
                                    key={agent.id}
                                    className="text-xs p-2 bg-emerald-50 rounded border border-emerald-200"
                                  >
                                    <div className="font-medium text-emerald-700 truncate">
                                      {agent.name}
                                    </div>
                                    <div className="text-emerald-600 text-[10px] truncate">
                                      {new Date(agent.readAt).toLocaleString(
                                        dateLocale,
                                        { timeZone: "Asia/Seoul" },
                                      )}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="text-xs text-slate-400 p-2 col-span-full">
                                  {t("notices.noReadAgents")}
                                </div>
                              )}
                            </div>
                          </div>
                          {(selectedNotice.unreadAgents?.length || 0) > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-amber-700 mb-2">
                                {t("notices.unreadAgentsTitle", {
                                  count:
                                    selectedNotice.unreadAgents?.length || 0,
                                })}
                              </h4>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                                {selectedNotice.unreadAgents?.map((agent) => (
                                  <div
                                    key={agent.id}
                                    className="text-xs p-2 bg-amber-50 rounded border border-amber-200"
                                  >
                                    <div className="font-medium text-amber-700 truncate">
                                      {agent.name}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Issues by source / profile (2-col grid) */}
          {Object.keys(ticketsByGame).length > 0 ? (
            <div
              className={`grid grid-cols-1 gap-6 ${
                Object.keys(ticketsByGame).length >= 2 ? "2xl:grid-cols-2" : ""
              }`}
            >
              {Object.entries(ticketsByGame).map(
                ([gameName, { highPriority, normal }]) => {
                  const fallbackStats = gameStats[gameName] ?? {
                    total: 0,
                    sev1: 0,
                    open: 0,
                  };
                  const allTickets = normal;
                  const cafeGameKey =
                    allTickets.find((t) => t.cafeGameCode)?.cafeGameCode ??
                    (gameName === "PUBG PC" ||
                    gameName === "PUBG_PC" ||
                    gameName === "데스크톱(공식 PC)"
                      ? "PUBG_PC"
                      : gameName === "PUBG MOBILE" ||
                          gameName === "PUBG Mobile" ||
                          gameName === "PUBG_MOBILE" ||
                          gameName === "모바일(공식)"
                        ? "PUBG_MOBILE"
                        : null);
                  const serverStats =
                    cafeGameKey && serverGameCounts
                      ? serverGameCounts[cafeGameKey]
                      : null;
                  const stats = serverStats ?? fallbackStats;
                  const gameDisplayName = gameName;

                  const neutralGameColors = {
                    bg: "bg-slate-50",
                    border: "border-slate-200",
                    text: "text-slate-800",
                    badge: "bg-slate-200 text-slate-800",
                  };
                  const colors = neutralGameColors;

                  // 해당 게임의 모든 이슈가 선택되어 있는지 확인
                  const gameSelectedTickets = allTickets.filter((t) =>
                    selectedTicketIds.has(t.id),
                  );
                  const isAllGameTicketsSelected =
                    allTickets.length > 0 &&
                    allTickets.every((t) => selectedTicketIds.has(t.id));
                  const isSomeGameTicketsSelected = allTickets.some((t) =>
                    selectedTicketIds.has(t.id),
                  );

                  // 해당 게임의 전체 선택/해제
                  const handleSelectAllGameTickets = () => {
                    if (isAllGameTicketsSelected) {
                      // 모두 선택되어 있으면 모두 해제
                      setSelectedTicketIds((prev) => {
                        const next = new Set(prev);
                        allTickets.forEach((t) => next.delete(t.id));
                        return next;
                      });
                    } else {
                      // 모두 선택
                      setSelectedTicketIds((prev) => {
                        const next = new Set(prev);
                        allTickets.forEach((t) => next.add(t.id));
                        return next;
                      });
                    }
                  };

                  return (
                    <div
                      key={gameName}
                      className={`rounded-2xl shadow-medium border-2 ${colors.border} ${colors.bg} p-5 backdrop-blur-sm hover-lift transition-all`}
                    >
                      {/* 게임 헤더 */}
                      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          <h2 className={`text-xl font-bold ${colors.text}`}>
                            {gameDisplayName}
                          </h2>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs ${colors.badge} px-2 py-1 rounded-full font-medium`}
                            >
                              {t("issues.total", { count: stats.total })}
                            </span>
                            {stats.sev1 > 0 && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                                {t("issues.sev1", { count: stats.sev1 })}
                              </span>
                            )}
                            {stats.open > 0 && (
                              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                                {t("issues.open", { count: stats.open })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 전체 선택 버튼 */}
                          {allTickets.length > 0 && (
                            <Button
                              onClick={handleSelectAllGameTickets}
                              variant={
                                isAllGameTicketsSelected ? "primary" : "outline"
                              }
                              size="sm"
                              title={
                                isAllGameTicketsSelected
                                  ? t("issues.deselectAll")
                                  : t("issues.selectAll")
                              }
                            >
                              {isAllGameTicketsSelected
                                ? t("issues.deselectAll")
                                : t("issues.selectAll")}
                              {isSomeGameTicketsSelected &&
                                !isAllGameTicketsSelected && (
                                  <span className="ml-1 text-xs">
                                    ({gameSelectedTickets.length}/
                                    {allTickets.length})
                                  </span>
                                )}
                            </Button>
                          )}
                          {selectedTicketIds.size > 0 && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="bg-gradient-to-r from-orange-100 to-orange-50 text-orange-700 border-2 border-orange-200 hover:from-orange-200 hover:to-orange-100"
                                title={t("issues.bulkUnreadTitle")}
                                onClick={async () => {
                                  const currentAgentId = getCurrentAgentId();
                                  if (!currentAgentId) {
                                    if (!user) {
                                      alert(t("alerts.loginRequired"));
                                    } else {
                                      alert(t("alerts.noAgentLinked"));
                                    }
                                    return;
                                  }
                                  // dateFilteredTickets에서 선택된 티켓 찾기 (기간 필터링 포함)
                                  const targetTickets =
                                    dateFilteredTickets.filter(
                                      (t) =>
                                        selectedTicketIds.has(t.id) &&
                                        t.issueId,
                                    );
                                  if (targetTickets.length === 0) {
                                    alert(t("alerts.noProcessable"));
                                    return;
                                  }
                                  if (
                                    !confirm(
                                      t("alerts.confirmUnread", {
                                        count: targetTickets.length,
                                      }),
                                    )
                                  )
                                    return;
                                  try {
                                    const headers: HeadersInit = {
                                      "Content-Type": "application/json",
                                    };
                                    if (token)
                                      (
                                        headers as Record<string, string>
                                      ).Authorization = `Bearer ${token}`;
                                    await Promise.all(
                                      targetTickets.map(async (ticket) => {
                                        if (!ticket.issueId) return;
                                        await fetch(
                                          withProjectParam(
                                            `/api/issues/${ticket.issueId}/uncheck`,
                                          ),
                                          {
                                            method: "POST",
                                            headers,
                                            body: JSON.stringify({
                                              agentId: currentAgentId,
                                            }),
                                          },
                                        ).catch(() => {});
                                      }),
                                    );
                                    setTickets((prev) =>
                                      prev.map((ticket) =>
                                        selectedTicketIds.has(ticket.id)
                                          ? {
                                              ...ticket,
                                              checkedAt: null,
                                              checkedBy: null,
                                              processedAt: null,
                                              processedBy: null,
                                              status: "OPEN",
                                            }
                                          : ticket,
                                      ),
                                    );
                                    clearSelection();
                                  } catch (error) {
                                    logger.error("Failed to revert issues", {
                                      error,
                                    });
                                    alert(t("alerts.unreadFailed"));
                                  }
                                }}
                              >
                                {t("issues.bulkUnread")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200"
                                title={t("issues.bulkCompleteTitle")}
                                onClick={async () => {
                                  const currentAgentId = getCurrentAgentId();
                                  if (!currentAgentId) {
                                    if (!user) {
                                      alert(t("alerts.loginRequired"));
                                    } else {
                                      alert(t("alerts.noAgentLinked"));
                                    }
                                    return;
                                  }
                                  // dateFilteredTickets에서 선택된 티켓 찾기 (기간 필터링 포함)
                                  const targetTickets =
                                    dateFilteredTickets.filter(
                                      (t) =>
                                        selectedTicketIds.has(t.id) &&
                                        t.issueId,
                                    );
                                  if (targetTickets.length === 0) {
                                    alert(t("alerts.noProcessable"));
                                    return;
                                  }
                                  if (
                                    !confirm(
                                      t("alerts.confirmComplete", {
                                        count: targetTickets.length,
                                      }),
                                    )
                                  )
                                    return;

                                  // 처리 시작: 진행 상황 모달 표시
                                  setProcessingProgress({
                                    current: 0,
                                    total: targetTickets.length,
                                    isProcessing: true,
                                  });

                                  try {
                                    // 배치 처리: 브라우저 리소스 부족 방지를 위해 작은 배치 크기 사용
                                    const BATCH_SIZE = 10; // 50 -> 10으로 줄임
                                    const results = [];
                                    let processedCount = 0;

                                    // 진행 상황 표시를 위한 상태 업데이트 함수
                                    const updateProgress = (
                                      current: number,
                                      total: number,
                                    ) => {
                                      setProcessingProgress({
                                        current,
                                        total,
                                        isProcessing: true,
                                      });
                                    };

                                    for (
                                      let i = 0;
                                      i < targetTickets.length;
                                      i += BATCH_SIZE
                                    ) {
                                      const batch = targetTickets.slice(
                                        i,
                                        i + BATCH_SIZE,
                                      );
                                      // 순차 처리로 변경: Promise.all 대신 for...of 루프 사용
                                      const batchResults = [];
                                      for (const ticket of batch) {
                                        if (!ticket.issueId) {
                                          logger.warn(
                                            "Ticket missing issueId",
                                            { ticketId: ticket.id },
                                          );
                                          batchResults.push({
                                            success: false,
                                            ticketId: ticket.issueId,
                                            error: "No issueId",
                                          });
                                          continue;
                                        }
                                        try {
                                          const headers: HeadersInit = {
                                            "Content-Type": "application/json",
                                          };
                                          if (token)
                                            (
                                              headers as Record<string, string>
                                            ).Authorization = `Bearer ${token}`;
                                          const res = await fetch(
                                            withProjectParam(
                                              `/api/issues/${ticket.issueId}/process`,
                                            ),
                                            {
                                              method: "POST",
                                              headers,
                                              body: JSON.stringify({
                                                agentId: currentAgentId,
                                              }),
                                            },
                                          );
                                          if (!res.ok) {
                                            const errorText = await res.text();
                                            let error;
                                            try {
                                              error = JSON.parse(errorText);
                                            } catch {
                                              error = {
                                                message:
                                                  errorText || "Unknown error",
                                              };
                                            }
                                            logger.error(
                                              "Failed to process issue",
                                              {
                                                ticketId: ticket.issueId,
                                                status: res.status,
                                                error,
                                              },
                                            );
                                            batchResults.push({
                                              success: false,
                                              ticketId: ticket.issueId,
                                              error:
                                                error.message ||
                                                `HTTP ${res.status}`,
                                            });
                                          } else {
                                            batchResults.push({
                                              success: true,
                                              ticketId: ticket.issueId,
                                            });
                                          }
                                          processedCount++;
                                          updateProgress(
                                            processedCount,
                                            targetTickets.length,
                                          );

                                          // 각 요청 간 짧은 지연 (브라우저 리소스 부족 방지)
                                          await new Promise((resolve) =>
                                            setTimeout(resolve, 50),
                                          );
                                        } catch (error) {
                                          logger.error(
                                            "Failed to process issue",
                                            { ticketId: ticket.issueId, error },
                                          );
                                          batchResults.push({
                                            success: false,
                                            ticketId: ticket.issueId,
                                            error:
                                              error instanceof Error
                                                ? error.message
                                                : String(error),
                                          });
                                          processedCount++;
                                          updateProgress(
                                            processedCount,
                                            targetTickets.length,
                                          );
                                        }
                                      }
                                      results.push(...batchResults);

                                      // 배치 간 지연 시간 증가 (브라우저 리소스 복구 시간)
                                      if (
                                        i + BATCH_SIZE <
                                        targetTickets.length
                                      ) {
                                        await new Promise((resolve) =>
                                          setTimeout(resolve, 200),
                                        );
                                      }
                                    }

                                    // 처리 완료: 진행 상황 모달 닫기
                                    setProcessingProgress(null);

                                    const failedCount = results.filter(
                                      (r) => !r.success,
                                    ).length;
                                    const successCount = results.filter(
                                      (r) => r.success,
                                    ).length;

                                    if (failedCount > 0) {
                                      const failedDetails = results
                                        .filter((r) => !r.success)
                                        .slice(0, 5)
                                        .map((r) => r.error)
                                        .join(", ");
                                      alert(
                                        t("alerts.completePartialFail", {
                                          failed: failedCount,
                                          success: successCount,
                                          details: failedDetails,
                                        }),
                                      );
                                      logger.warn(
                                        "Some issues failed to process",
                                        {
                                          failedCount,
                                          successCount,
                                          total: targetTickets.length,
                                          sampleErrors: results
                                            .filter((r) => !r.success)
                                            .slice(0, 5),
                                        },
                                      );
                                    } else {
                                      alert(
                                        t("alerts.completeOk", {
                                          count: targetTickets.length,
                                        }),
                                      );
                                    }

                                    // 성공한 이슈만 UI 업데이트
                                    const timestamp = Date.now();
                                    const successfulIssueIds = new Set(
                                      results
                                        .filter((r) => r.success)
                                        .map((r) => r.ticketId),
                                    );
                                    setTickets((prev) =>
                                      prev.map((ticket) => {
                                        if (
                                          selectedTicketIds.has(ticket.id) &&
                                          successfulIssueIds.has(ticket.issueId)
                                        ) {
                                          return {
                                            ...ticket,
                                            processedAt: timestamp,
                                            processedBy: currentAgentId,
                                            status: "RESOLVED",
                                          };
                                        }
                                        return ticket;
                                      }),
                                    );
                                    clearSelection();
                                  } catch (error) {
                                    // 에러 발생 시 진행 상황 모달 닫기
                                    setProcessingProgress(null);
                                    logger.error("Failed to process issues", {
                                      error,
                                    });
                                    alert(
                                      t("alerts.batchFailed", {
                                        message:
                                          error instanceof Error
                                            ? error.message
                                            : String(error),
                                      }),
                                    );
                                  }
                                }}
                              >
                                {t("issues.bulkComplete")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="bg-orange-600 text-white border-orange-700 hover:bg-orange-700"
                                title={t("issues.bulkExcludeTitle")}
                                onClick={async () => {
                                  const currentAgentId = getCurrentAgentId();
                                  if (!currentAgentId) {
                                    if (!user) {
                                      alert(t("alerts.loginRequired"));
                                    } else {
                                      alert(t("alerts.noAgentLinked"));
                                    }
                                    return;
                                  }
                                  // dateFilteredTickets에서 선택된 티켓 찾기 (기간 필터링 포함)
                                  const targetTickets =
                                    dateFilteredTickets.filter(
                                      (t) =>
                                        selectedTicketIds.has(t.id) &&
                                        t.issueId,
                                    );
                                  if (targetTickets.length === 0) {
                                    alert(t("alerts.noProcessable"));
                                    return;
                                  }
                                  if (
                                    !confirm(
                                      t("alerts.confirmExclude", {
                                        count: targetTickets.length,
                                      }),
                                    )
                                  )
                                    return;
                                  try {
                                    const results = await Promise.all(
                                      targetTickets.map(async (ticket) => {
                                        if (!ticket.issueId)
                                          return {
                                            success: false,
                                            ticketId: ticket.issueId,
                                          };
                                        try {
                                          const headers: HeadersInit = {
                                            "Content-Type": "application/json",
                                          };
                                          if (token)
                                            (
                                              headers as Record<string, string>
                                            ).Authorization = `Bearer ${token}`;
                                          const res = await fetch(
                                            withProjectParam(
                                              `/api/issues/${ticket.issueId}/exclude-from-report`,
                                            ),
                                            {
                                              method: "POST",
                                              headers,
                                              body: JSON.stringify({
                                                agentId: currentAgentId,
                                              }),
                                            },
                                          );
                                          if (!res.ok) {
                                            const error = await res
                                              .json()
                                              .catch(() => ({
                                                message: "Unknown error",
                                              }));
                                            logger.error(
                                              "Failed to exclude issue from report",
                                              {
                                                ticketId: ticket.issueId,
                                                error,
                                              },
                                            );
                                            return {
                                              success: false,
                                              ticketId: ticket.issueId,
                                              error: error.message,
                                            };
                                          }
                                          return {
                                            success: true,
                                            ticketId: ticket.issueId,
                                          };
                                        } catch (error) {
                                          logger.error(
                                            "Failed to exclude issue from report",
                                            { ticketId: ticket.issueId, error },
                                          );
                                          return {
                                            success: false,
                                            ticketId: ticket.issueId,
                                            error:
                                              error instanceof Error
                                                ? error.message
                                                : String(error),
                                          };
                                        }
                                      }),
                                    );

                                    const failedCount = results.filter(
                                      (r) => !r.success,
                                    ).length;
                                    if (failedCount > 0) {
                                      alert(
                                        t("alerts.excludePartialFail", {
                                          count: failedCount,
                                        }),
                                      );
                                      logger.warn(
                                        "Some issues failed to exclude from report",
                                        {
                                          failedCount,
                                          total: targetTickets.length,
                                          results,
                                        },
                                      );
                                    } else {
                                      // 성공 메시지 표시 후 새로고침
                                      alert(
                                        t("alerts.excludeOk", {
                                          count: targetTickets.length,
                                        }),
                                      );
                                      // 서버 업데이트 반영 시간 확보 후 새로고침
                                      setTimeout(() => {
                                        window.location.reload();
                                      }, 1000);
                                      return;
                                    }
                                    // 실패한 경우에도 로컬 상태 업데이트
                                    const timestamp = Date.now();
                                    setTickets((prev) =>
                                      prev.map((ticket) =>
                                        selectedTicketIds.has(ticket.id)
                                          ? {
                                              ...ticket,
                                              excludedFromReport: true,
                                              excludedAt: timestamp,
                                              excludedBy: currentAgentId,
                                              processedAt: timestamp,
                                              processedBy: currentAgentId,
                                              status: "RESOLVED",
                                            }
                                          : ticket,
                                      ),
                                    );
                                    clearSelection();
                                  } catch (error) {
                                    logger.error(
                                      "Failed to exclude issues from report",
                                      { error },
                                    );
                                    alert(t("alerts.excludeFailed"));
                                  }
                                }}
                              >
                                {t("issues.bulkExclude")}
                              </Button>
                            </>
                          )}
                          <span
                            className={`text-xs ${colors.text} font-medium`}
                          >
                            {t("issues.countBadge", { count: stats.total })}
                          </span>
                        </div>
                      </div>

                      {/* 중요 이슈 서브섹션 */}
                      {highPriority.length > 0 && (
                        <div className="mb-4">
                          {/* 헤더 - 토글 버튼 */}
                          <div
                            className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-50 rounded-lg transition-colors mb-2"
                            onClick={() =>
                              setIsHighPriorityExpanded(!isHighPriorityExpanded)
                            }
                          >
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-red-700">
                                🔴 {t("issues.highPriority")}
                              </h3>
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                                {t("issues.countBadge", {
                                  count: highPriority.length,
                                })}
                              </span>
                            </div>
                            <button
                              className="text-slate-500 hover:text-slate-700 transition-transform"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsHighPriorityExpanded(
                                  !isHighPriorityExpanded,
                                );
                              }}
                              title={
                                isHighPriorityExpanded
                                  ? t("filters.collapse")
                                  : t("filters.expand")
                              }
                            >
                              <span
                                className={`inline-block transition-transform duration-200 ${isHighPriorityExpanded ? "rotate-180" : ""}`}
                              >
                                ▼
                              </span>
                            </button>
                          </div>

                          {/* 컨텐츠 - 접기/펼치기 */}
                          <div
                            className={`transition-all duration-300 ease-in-out ${isHighPriorityExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}
                          >
                            <div className="space-y-2 max-h-96 overflow-y-auto overflow-x-auto">
                              {/* Discourse Latest 유사 컬럼 헤더 */}
                              <div className="hidden md:grid grid-cols-[minmax(0,1fr)_80px_80px_90px_140px_120px] gap-3 px-3 text-xs text-slate-500 sticky top-0 bg-white/80 backdrop-blur border-b border-slate-100 z-10 min-w-[1010px]">
                                <div className="py-2 pr-3">Topic</div>
                                <div className="py-2 text-right">Replies</div>
                                <div className="py-2 text-right">Likes</div>
                                <div className="py-2 text-right">Views</div>
                                <div className="py-2 text-right">Activity</div>
                                <div className="py-2 text-right">Preview</div>
                              </div>
                              {highPriority.map((ticket) => (
                                <div key={ticket.id}>
                                  {renderCardItem(ticket)}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 전체 이슈 서브섹션 */}
                      {normal.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              {t("issues.allIssues")}
                            </h3>
                            <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-medium">
                              {t("issues.countBadge", { count: normal.length })}
                            </span>
                          </div>
                          <div className="space-y-2 max-h-[600px] overflow-y-auto overflow-x-auto">
                            {/* Discourse Latest 유사 컬럼 헤더 */}
                            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_80px_80px_90px_140px_120px] gap-3 px-3 text-xs text-slate-500 sticky top-0 bg-white/80 backdrop-blur border-b border-slate-100 z-10 min-w-[1010px]">
                              <div className="py-2 pr-3">Topic</div>
                              <div className="py-2 text-right">Replies</div>
                              <div className="py-2 text-right">Likes</div>
                              <div className="py-2 text-right">Views</div>
                              <div className="py-2 text-right">Activity</div>
                              <div className="py-2 text-right">Preview</div>
                            </div>
                            {normal.map((ticket) => (
                              <div key={ticket.id}>
                                {renderCardItem(ticket)}
                              </div>
                            ))}
                          </div>
                          {/* 전역 더보기 (내부 스크롤이든 페이지 스크롤이든 확실하게 동작) */}
                          {hasMoreIssues && (
                            <div className="mt-3 flex items-center justify-center">
                              <button
                                type="button"
                                onClick={() => loadMoreIssues()}
                                disabled={loadingMore}
                                className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                                  loadingMore
                                    ? "bg-slate-100 text-slate-400 border-slate-200"
                                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                                }`}
                                title={t("issues.loadMoreTitle")}
                              >
                                {loadingMore
                                  ? t("issues.loadingMore")
                                  : t("issues.loadMore")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {allTickets.length === 0 && (
                        <div className="py-6 text-center text-slate-400 text-sm">
                          {debouncedSearchQuery &&
                          debouncedSearchQuery.trim().length > 0 ? (
                            <>
                              <p className="font-medium mb-1">
                                {t("issues.emptySearch")}
                              </p>
                              <p className="text-xs">
                                {t("issues.emptySearchHint")}
                              </p>
                            </>
                          ) : (
                            t("issues.emptyForGroup", { name: gameDisplayName })
                          )}
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border p-4">
              <div className="py-6 text-center text-slate-400 text-sm">
                {t("issues.emptyNoTickets")}
              </div>
            </div>
          )}

          {/* 페이지 하단 전역 무한 스크롤 트리거 */}
          {hasMoreIssues && <div ref={loadMoreTriggerRef} className="h-10" />}

          {/* 이슈 상세 패널 */}
          {selectedTicket && (
            <IssueDetailPanel
              ticket={selectedTicket}
              agents={projectAgents}
              comments={issueComments}
              commentsLoading={commentsLoading}
              newComment={commentInput}
              submittingComment={commentSubmitting}
              onClose={closeDetailPanel}
              onStatusChange={handleStatusUpdate}
              onAssignAgent={handleAssignAgent}
              onCommentChange={setCommentInput}
              onSubmitComment={handleCommentSubmit}
            />
          )}
        </>
      ) : (
        <ViewRouter
          currentView={currentView}
          onBackToMain={() => setCurrentView("main")}
        />
      )}

      {/* 수동 수집 모달 - 상단 메뉴에서 열므로 항상 렌더 */}
      <ManualIngestModal
        isOpen={showManualIngestModal}
        onClose={() => setShowManualIngestModal(false)}
        onSuccess={() => {
          window.location.reload();
        }}
      />

      {/* 처리 진행 상황 모달 */}
      <ProcessingProgressModal processingProgress={processingProgress} />
    </div>
  );
}
