import { useState, useEffect, useMemo, useRef, useCallback, type ChangeEvent, memo } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Ticket, IssueComment, IssueWorkflowStatus, IssueShareLog } from "../types";
import { useAuth } from "../auth/AuthContext";
import { logger } from "../utils/logger";
import { createAuthHeaders } from "../utils/headers";
import { acquireIssueLock, releaseIssueLock, refreshIssueLock, type IssueLock } from "../utils/issueLock";
import { LocalizedDateInput } from "./LocalizedDateInput";

// 5단계로 단순화 (WAITING→대응중, VERIFIED→완료로 통합)
const STATUS_OPTIONS: IssueWorkflowStatus[] = [
  "OPEN",
  "TRIAGED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED"
];

interface Category {
  id: number;
  name: string;
  code: string;
  groupId: number;
}

interface CategoryGroup {
  id: number;
  name: string;
  code: string;
  importance: string;
  color?: string | null;
  description?: string | null;
  categories: Category[];
}

interface IssueDetailPanelProps {
  ticket: Ticket;
  agents: Agent[];
  comments: IssueComment[];
  commentsLoading: boolean;
  newComment: string;
  submittingComment: boolean;
  onClose: () => void;
  onStatusChange: (status: IssueWorkflowStatus) => void;
  onAssignAgent: (agentId: string) => void;
  onCommentChange: (value: string) => void;
  onSubmitComment: () => void;
}

function isNaverCafeArticleUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === "cafe.naver.com" || u.hostname.endsWith(".cafe.naver.com");
  } catch {
    return false;
  }
}

function parseDiscoursePreambleImageUrl(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const head = detail.split("\n").slice(0, 60).join("\n");
  if (!head.includes("Discourse (inZOI Forums)")) return null;
  const imageLine = head
    .split("\n")
    .find((l) => l.trim().startsWith("대표 이미지:"));
  const url = imageLine ? imageLine.replace("대표 이미지:", "").trim() : "";
  return url ? url : null;
}

function parseTicketPostImagePaths(ticket: {
  postImagePaths?: string[] | string | null;
}): string[] {
  const raw = ticket.postImagePaths;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) {
        return p.filter((x): x is string => typeof x === "string" && x.length > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function mergeIssueDisplayImagePaths(
  ticket: { screenshotPath?: string | null; postImagePaths?: string[] | string | null },
  localScreenshotPath: string | null
): string[] {
  const fromTicket = parseTicketPostImagePaths(ticket);
  const primary = localScreenshotPath || ticket.screenshotPath;
  if (!primary) return fromTicket;
  if (fromTicket.includes(primary)) return fromTicket;
  return [primary, ...fromTicket];
}

function commentWatchApiPath(issueId: string, projectId: number | null | undefined): string {
  const enc = encodeURIComponent(issueId);
  const qs = projectId != null ? `?projectId=${projectId}` : "";
  return `/api/issues/${enc}/comment-watch${qs}`;
}

// 스크린샷 이미지 컴포넌트 (로딩 상태 및 에러 처리 포함)
function ScreenshotImage({ screenshotPath }: { screenshotPath: string }) {
  const { t } = useTranslation("components");
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const imageUrl = `/uploads/${screenshotPath}`;

  useEffect(() => {
    // 이미지 URL이 변경될 때마다 상태 리셋
    setImageLoading(true);
    setImageError(false);
  }, [screenshotPath]);

  const handleImageClick = () => {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head>
            <title>${t("issueDetail.screenshot.viewTitle")}</title>
            <style>
              body {
                margin: 0;
                padding: 20px;
                background: #1e293b;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
              }
              img {
                max-width: 100%;
                max-height: 100vh;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
              }
            </style>
          </head>
          <body>
            <img src="${imageUrl}" alt="${t("issueDetail.screenshot.alt")}" />
          </body>
        </html>
      `);
    }
  };

  if (imageError) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-100 dark:bg-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{t("issueDetail.screenshot.loadError")}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 break-all">
          {t("issueDetail.screenshot.pathLabel")} {screenshotPath}
        </p>
        <button
          onClick={() => {
            setImageError(false);
            setImageLoading(true);
          }}
          className="mt-2 px-3 py-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600"
        >
          {t("issueDetail.screenshot.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {imageLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-lg">
          <div className="text-sm text-slate-500 dark:text-slate-400">{t("issueDetail.screenshot.loading")}</div>
        </div>
      )}
      <img
        src={imageUrl}
        alt={t("issueDetail.screenshot.postCaptureAlt")}
        className={`w-full rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-90 transition-opacity ${
          imageLoading ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleImageClick}
        onLoad={() => {
          setImageLoading(false);
          setImageError(false);
        }}
        onError={(e) => {
          console.error('이미지 로딩 실패:', imageUrl, e);
          setImageLoading(false);
          setImageError(true);
        }}
      />
    </div>
  );
}

function IssueDetailPanel({
  ticket,
  agents,
  comments,
  commentsLoading,
  newComment,
  submittingComment,
  onClose,
  onStatusChange,
  onAssignAgent,
  onCommentChange,
  onSubmitComment
}: IssueDetailPanelProps) {
  const { t, i18n } = useTranslation("components");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";
  const formatDate = useCallback((value?: number) => {
    if (!value) return "-";
    return new Date(value).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" });
  }, [dateLocale]);
  const sentimentLabelShort = useCallback(
    (s: string) =>
      s === "pos"
        ? t("issueDetail.sentimentLabels.pos")
        : s === "neg"
          ? t("issueDetail.sentimentLabels.neg")
          : t("issueDetail.sentimentLabels.neu"),
    [t]
  );
  const { token, user, selectedProjectId } = useAuth();
  const authHeaders = useMemo<HeadersInit | undefined>(
    () => createAuthHeaders(token),
    [token]
  );
  const discourseImageUrl = useMemo(() => parseDiscoursePreambleImageUrl(ticket.detail), [ticket.detail]);

  useEffect(() => {
    if (!token || !ticket.issueId || !isNaverCafeArticleUrl(ticket.link)) {
      setCommentWatch(null);
      return;
    }
    let cancelled = false;
    setCommentWatchLoading(true);
    const projectId = ticket.projectId ?? selectedProjectId;
    (async () => {
      try {
        const path = commentWatchApiPath(ticket.issueId!, projectId);
        const res = await fetch(path, {
          headers: authHeaders
        });
        if (!res.ok) {
          logger.warn("[IssueDetailPanel] comment-watch GET failed", {
            status: res.status,
            path
          });
          if (!cancelled) setCommentWatch(null);
          return;
        }
        const body = await res.json();
        const data = body.data ?? body;
        const w = data.watch as {
          enabled: boolean;
          intervalSeconds?: number;
          intervalMinutes?: number;
          nextRunAt?: string | null;
          lastRunAt?: string | null;
          lastError?: string | null;
        } | null;
        if (!cancelled) {
          setCommentWatch(w);
          if (w?.intervalMinutes) setWatchIntervalMinutes(w.intervalMinutes);
          else if (w?.intervalSeconds) setWatchIntervalMinutes(Math.max(1, Math.round(w.intervalSeconds / 60)));
        }
      } catch {
        if (!cancelled) setCommentWatch(null);
      } finally {
        if (!cancelled) setCommentWatchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, ticket.issueId, ticket.link, ticket.projectId, selectedProjectId, authHeaders]);

  // 카테고리 데이터
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  
  // 이슈 잠금 관련 상태
  const [issueLock, setIssueLock] = useState<IssueLock | null>(null);
  const [lockConflict, setLockConflict] = useState<{ locked: boolean; lockedBy: string } | null>(null);
  const [acquiringLock, setAcquiringLock] = useState(true);
  const lockHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 슬랙 공유 관련 상태
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLogs, setShareLogs] = useState<IssueShareLog[]>([]);
  const [, setLoadingShareLogs] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [slackChannels, setSlackChannels] = useState<Array<{id: string, name: string, isPrivate: boolean}>>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [slackUsers, setSlackUsers] = useState<Array<{id: string; name: string; displayName?: string}>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  
  // 슬랙 공유 구조화된 필드 상태
  const [shareForm, setShareForm] = useState({
    sender: '', // 보내는 사람
    receiver: '', // 받는 사람
    date: '', // 날짜
    time: '', // 시간
    title: '', // 제목
    content: '', // 내용
    relatedUrl: '', // 관련 URL
    userInfo: '', // 유저정보
    testResult: '' // 내부 테스트 결과
  });
  
  // 스크린샷 캡처 관련 상태
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [shareTarget] = useState('Client_Channel');
  
  // 클립보드 이미지 업로드 관련 상태
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pastedImagePreview, setPastedImagePreview] = useState<string | null>(null);
  
  // 로컬 screenshotPath 상태 (업로드 후 즉시 반영)
  const [localScreenshotPath, setLocalScreenshotPath] = useState<string | null>(ticket.screenshotPath || null);
  
  // 이미지 삭제 여부 (슬랙 공유 시 이미지 제외)
  const [excludeImage, setExcludeImage] = useState(false);
  
  // 캡처 클립(비디오) 업로드 관련 상태
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);

  /** 네이버 카페 원문 댓글 주기 감시(관리 모드) */
  const [commentWatch, setCommentWatch] = useState<{
    enabled: boolean;
    intervalSeconds?: number;
    intervalMinutes?: number;
    nextRunAt?: string | null;
    lastRunAt?: string | null;
    lastError?: string | null;
  } | null>(null);
  const [commentWatchLoading, setCommentWatchLoading] = useState(false);
  const [commentWatchSaving, setCommentWatchSaving] = useState(false);
  const [watchIntervalMinutes, setWatchIntervalMinutes] = useState(30);
  
  // ticket의 screenshotPath가 변경되면 동기화 (단, 로컬에 업로드된 이미지가 없을 때만)
  useEffect(() => {
    const ticketScreenshotPath = ticket.screenshotPath;
    if (ticketScreenshotPath && ticketScreenshotPath !== localScreenshotPath) {
      // 로컬 상태가 없거나, ticket의 경로가 더 최신인 경우에만 업데이트
      if (!localScreenshotPath) {
        setLocalScreenshotPath(ticketScreenshotPath);
      }
    }
  }, [ticket.screenshotPath, localScreenshotPath]);

  const displayPostImagePaths = useMemo(
    () => mergeIssueDisplayImagePaths(ticket, localScreenshotPath),
    [ticket, localScreenshotPath]
  );
  
  // 검수 폼 상태
  const [selectedCategoryGroupId, setSelectedCategoryGroupId] = useState<number | null>(ticket.categoryGroupId || null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(ticket.categoryId || null);
  const [selectedSeverity, setSelectedSeverity] = useState<number>(ticket.severity || 3);
  const [selectedSentiment, setSelectedSentiment] = useState<string>(ticket.sentiment || 'neu');
  const [trend, setTrend] = useState<string>(ticket.trend || '');
  const [aiClassificationReason, setAiClassificationReason] = useState<string>(ticket.aiClassificationReason || '');
  const [editingAiReason, setEditingAiReason] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // AI 제안값 (티켓이 처음 로드될 때의 값 - 티켓 ID가 변경될 때만 업데이트)
  const [aiSuggestedCategoryGroupId, setAiSuggestedCategoryGroupId] = useState<number | null>(ticket.categoryGroupId || null);
  const [aiSuggestedCategoryId, setAiSuggestedCategoryId] = useState<number | null>(ticket.categoryId || null);
  const [aiSuggestedSeverity, setAiSuggestedSeverity] = useState<number>(ticket.severity || 3);
  const [aiSuggestedSentiment, setAiSuggestedSentiment] = useState<string>(ticket.sentiment || 'neu');
  const [aiSuggestedTrend, setAiSuggestedTrend] = useState<string>(ticket.trend || '');
  const [analyzingSentiment, setAnalyzingSentiment] = useState(false);
  const [_removingKeywordMarker, _setRemovingKeywordMarker] = useState(false);

  // 티켓 ID 추적 (티켓이 변경되었는지 확인용) - useRef로 무한 루프 방지
  const lastTicketIdRef = useRef<string | null>(null);
  // 자동 선택 플래그 (무한 루프 방지)
  const autoSelectGroupRef = useRef(false);
  const autoSelectCategoryRef = useRef(false);
  // 이전 티켓 필드 값 추적 (실제 변경 여부 확인용)
  const prevTicketFieldsRef = useRef<{
    categoryGroupId: number | null;
    categoryId: number | null;
    severity: number;
    trend: string;
    aiClassificationReason: string;
    sentiment: string;
  } | null>(null);
  // useEffect 실행 횟수 추적 (무한 루프 방지)
  const effectRunCountRef = useRef(0);
  const lastEffectRunRef = useRef<number>(0);

  // 티켓 필드 값들을 개별적으로 추출 (메모이제이션으로 안정적인 참조 유지)
  const ticketIssueId = useMemo(() => ticket.issueId, [ticket.issueId]);
  const ticketCategoryGroupId = useMemo(() => ticket.categoryGroupId || null, [ticket.categoryGroupId]);
  const ticketCategoryId = useMemo(() => ticket.categoryId || null, [ticket.categoryId]);
  const ticketSeverity = useMemo(() => ticket.severity || 3, [ticket.severity]);
  const ticketTrend = useMemo(() => ticket.trend || '', [ticket.trend]);
  const ticketAiClassificationReason = useMemo(() => ticket.aiClassificationReason || '', [ticket.aiClassificationReason]);
  const ticketSentiment = useMemo(() => ticket.sentiment || 'neu', [ticket.sentiment]);
  const ticketAiClassificationMethod = useMemo(() => ticket.aiClassificationMethod, [ticket.aiClassificationMethod]);

  // 티켓이 변경될 때 AI 제안값과 선택된 값을 동기화
  // 무한 루프 방지: 이전 값과 비교하여 실제로 변경된 경우에만 업데이트
  // 모바일 최적화: 개별 필드 추적 및 엄격한 변경 감지 + 디바운싱 + 실행 횟수 제한
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    if (!ticketIssueId) return;

    // 실행 횟수 추적 및 제한 (무한 루프 방지)
    const now = Date.now();
    effectRunCountRef.current += 1;
    
    // 1초 이내에 10번 이상 실행되면 무한 루프로 간주하고 중단
    if (now - lastEffectRunRef.current < 1000 && effectRunCountRef.current > 10) {
      logger.warn('[IssueDetailPanel] Too many effect runs detected, skipping update', {
        count: effectRunCountRef.current,
        timeSinceLastRun: now - lastEffectRunRef.current
      });
      return;
    }
    
    // 1초가 지나면 카운터 리셋
    if (now - lastEffectRunRef.current >= 1000) {
      effectRunCountRef.current = 0;
    }
    
    lastEffectRunRef.current = now;

    // 기존 타이머가 있으면 취소 (디바운싱)
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    const isTicketChanged = lastTicketIdRef.current !== ticketIssueId;
    const prevFields = prevTicketFieldsRef.current;
    
    // 디바운싱: 짧은 지연 후 실행 (모바일 최적화)
    syncTimeoutRef.current = setTimeout(() => {
      // 티켓 ID가 변경된 경우: AI 제안값과 선택값 모두 초기화
      if (isTicketChanged) {
        lastTicketIdRef.current = ticketIssueId;
        // 자동 선택 플래그 리셋
        autoSelectGroupRef.current = false;
        autoSelectCategoryRef.current = false;
        
        // 이전 필드 값 저장 (상태 업데이트 전에)
        prevTicketFieldsRef.current = {
          categoryGroupId: ticketCategoryGroupId,
          categoryId: ticketCategoryId,
          severity: ticketSeverity,
          trend: ticketTrend,
          aiClassificationReason: ticketAiClassificationReason,
          sentiment: ticketSentiment
        };
        
        // 모바일 최적화: 이중 requestAnimationFrame으로 더 안전한 배치 업데이트
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAiSuggestedCategoryGroupId(ticketCategoryGroupId);
            setAiSuggestedCategoryId(ticketCategoryId);
            setAiSuggestedSeverity(ticketSeverity);
            setAiSuggestedSentiment(ticketSentiment);
            setAiSuggestedTrend(ticketTrend);
            setSelectedCategoryGroupId(ticketCategoryGroupId);
            setSelectedCategoryId(ticketCategoryId);
            setSelectedSeverity(ticketSeverity);
            setSelectedSentiment(ticketSentiment);
            setTrend(ticketTrend);
            setAiClassificationReason(ticketAiClassificationReason);
          });
        });
      } else if (prevFields) {
        // 같은 티켓이지만 필드 값이 실제로 변경된 경우에만 업데이트
        // 변경된 필드만 배치로 업데이트
        const updates: Array<() => void> = [];
        
        if (prevFields.categoryGroupId !== ticketCategoryGroupId) {
          updates.push(() => setSelectedCategoryGroupId(ticketCategoryGroupId));
        }
        if (prevFields.categoryId !== ticketCategoryId) {
          updates.push(() => setSelectedCategoryId(ticketCategoryId));
        }
        if (prevFields.severity !== ticketSeverity) {
          updates.push(() => setSelectedSeverity(ticketSeverity));
        }
        if (prevFields.sentiment !== ticketSentiment) {
          updates.push(() => setSelectedSentiment(ticketSentiment));
        }
        if (prevFields.trend !== ticketTrend) {
          updates.push(() => setTrend(ticketTrend));
        }
        if (prevFields.aiClassificationReason !== ticketAiClassificationReason) {
          updates.push(() => setAiClassificationReason(ticketAiClassificationReason));
        }
        
        // 변경사항이 있을 때만 배치 업데이트 (이중 requestAnimationFrame)
        if (updates.length > 0) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              updates.forEach(update => update());
            });
          });
        }
        
        // 이전 필드 값 업데이트
        prevTicketFieldsRef.current = {
          categoryGroupId: ticketCategoryGroupId,
          categoryId: ticketCategoryId,
          severity: ticketSeverity,
          trend: ticketTrend,
          aiClassificationReason: ticketAiClassificationReason,
          sentiment: ticketSentiment
        };
      } else {
        // 초기 로드 시 이전 필드 값 저장
        prevTicketFieldsRef.current = {
          categoryGroupId: ticketCategoryGroupId,
          categoryId: ticketCategoryId,
          severity: ticketSeverity,
          trend: ticketTrend,
          aiClassificationReason: ticketAiClassificationReason,
          sentiment: ticketSentiment
        };
      }
      
      syncTimeoutRef.current = null;
    }, 50); // 50ms 디바운싱

    // cleanup
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
  }, [ticketIssueId, ticketCategoryGroupId, ticketCategoryId, ticketSeverity, ticketTrend, ticketAiClassificationReason, ticketSentiment, ticketAiClassificationMethod]); // 개별 필드만 의존성으로 사용

  // 이슈 잠금 관리
  useEffect(() => {
    let mounted = true;

    // 잠금 획득 시도
    async function tryAcquireLock() {
      if (!ticket.issueId) return;

      try {
        setAcquiringLock(true);
        const result = await acquireIssueLock(ticket.issueId);

        if (!mounted) return;

        if (result.success && result.lock) {
          setIssueLock(result.lock);
          setLockConflict(null);
          logger.info('[IssueLock] Lock acquired successfully', { issueId: ticket.issueId });

          // 잠금 유지를 위한 하트비트 시작 (2분마다)
          if (ticket.issueId) {
            lockHeartbeatRef.current = setInterval(async () => {
              try {
                await refreshIssueLock(ticket.issueId!);
                logger.debug('[IssueLock] Lock refreshed', { issueId: ticket.issueId });
              } catch (error) {
                logger.error('[IssueLock] Failed to refresh lock', { issueId: ticket.issueId, error });
              }
            }, 2 * 60 * 1000); // 2분
          }
        } else if (result.existingLock) {
          setLockConflict({
            locked: true,
            lockedBy: result.existingLock.userName
          });
          logger.warn('[IssueLock] Issue is locked by another user', {
            issueId: ticket.issueId,
            lockedBy: result.existingLock.userName
          });
        }
      } catch (error) {
        logger.error('[IssueLock] Failed to acquire lock', { issueId: ticket.issueId, error });
        if (mounted) {
          setLockConflict({
            locked: false,
            lockedBy: t("issueDetail.lock.unknownUser")
          });
        }
      } finally {
        if (mounted) {
          setAcquiringLock(false);
        }
      }
    }

    tryAcquireLock();

    // 정리 함수: 잠금 해제 및 하트비트 중지
    return () => {
      mounted = false;

      // 하트비트 중지
      if (lockHeartbeatRef.current) {
        clearInterval(lockHeartbeatRef.current);
        lockHeartbeatRef.current = null;
      }

      // 잠금 해제
      if (ticket.issueId && issueLock) {
        releaseIssueLock(ticket.issueId).catch((error) => {
          logger.error('[IssueLock] Failed to release lock', { issueId: ticket.issueId, error });
        });
      }
    };
  }, [ticket.issueId]); // ticket.issueId가 변경될 때만 실행

  // WebSocket으로 다른 사용자의 잠금 이벤트 수신
  // Note: 잠금 이벤트는 현재 useRealtime 훅에서 지원하지 않으므로 주석 처리
  // 필요시 useRealtime에 잠금 이벤트 핸들러를 추가해야 함
  // useEffect(() => {
  //   // 잠금 이벤트 처리 로직
  // }, [ticket.issueId, user?.id]);

  // 카테고리 그룹 로드
  useEffect(() => {
    const loadCategories = async () => {
      if (!token) return;
      setLoadingCategories(true);
      try {
        // 이슈가 속한 프로젝트의 카테고리를 로드 (이슈와 일치하는 프로젝트의 카테고리 사용)
        // ticket.projectId가 우선 (이슈가 속한 프로젝트), 없으면 selectedProjectId 사용, 둘 다 없으면 기본값 1 사용
        const targetProjectId = ticket.projectId ?? selectedProjectId ?? 1;
        
        const url = `/api/categories/tree?projectId=${targetProjectId}`;
        logger.info('Loading categories for project', { 
          projectId: targetProjectId, 
          ticketProjectId: ticket.projectId, 
          selectedProjectId,
          usingTicketProject: !!ticket.projectId,
          usingSelectedProject: !ticket.projectId && !!selectedProjectId,
          usingDefault: !ticket.projectId && !selectedProjectId,
          gameName: ticket.gameName
        });
        const res = await fetch(url, { headers: authHeaders || undefined });
        if (res.ok) {
          const body = await res.json();
          const groups = body?.data ?? body;
          logger.info('Categories loaded', { projectId: targetProjectId, count: Array.isArray(groups) ? groups.length : 0 });
          // 중복 제거: id 기준으로 유일한 그룹만 유지, 그 다음 name 기준으로도 중복 제거
          if (Array.isArray(groups)) {
            // 디버깅: 원본 데이터 확인
            if (groups.length !== new Set(groups.map((g: CategoryGroup) => g.id)).size) {
              logger.warn('Duplicate category groups detected by id', { 
                total: groups.length, 
                unique: new Set(groups.map((g: CategoryGroup) => g.id)).size 
              });
            }
            // 1단계: id 기준 중복 제거
            const idUniqueGroups = Array.from(
              new Map(groups.map((group: CategoryGroup) => [group.id, group])).values()
            );
            // 2단계: name 기준 중복 제거 (같은 name이면 첫 번째 것만 유지)
            const nameUniqueMap = new Map<string, CategoryGroup>();
            for (const group of idUniqueGroups) {
              if (!nameUniqueMap.has(group.name)) {
                nameUniqueMap.set(group.name, group);
              } else {
                logger.warn('Duplicate category group name detected', { 
                  name: group.name, 
                  id: group.id,
                  existingId: nameUniqueMap.get(group.name)?.id 
                });
              }
            }
            const uniqueGroups = Array.from(nameUniqueMap.values());
            // 이름 순으로 정렬
            uniqueGroups.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
            setCategoryGroups(uniqueGroups);
          } else {
            setCategoryGroups([]);
          }
        } else {
          const errorBody = await res.json().catch(() => ({}));
          logger.error('Failed to load categories', { 
            status: res.status, 
            error: errorBody,
            projectId: targetProjectId,
            url 
          });
          setCategoryGroups([]);
        }
      } catch (error) {
        logger.error('Failed to load categories', { error });
      } finally {
        setLoadingCategories(false);
      }
    };
    loadCategories();
  }, [token, authHeaders, selectedProjectId, ticket.projectId]);

  // Sentiment 분석 함수
  const analyzeSentiment = useCallback(async () => {
    if (!ticket.issueId || !token) {
      setAnalyzingSentiment(false);
      return;
    }
    
    // 이슈에 내용이 없으면 분석하지 않음
    if (!ticket.summary && !ticket.detail) {
      logger.debug('[IssueDetailPanel] Skipping sentiment analysis - no content', { issueId: ticket.issueId });
      setAnalyzingSentiment(false);
      return;
    }
    
    setAnalyzingSentiment(true);
    
    try {
      const projectId = ticket.projectId ?? selectedProjectId;
      const url = `/api/issues/${ticket.issueId}/analyze-sentiment${projectId ? `?projectId=${projectId}` : ''}`;
      
      // 타임아웃 설정 (15초)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders || undefined,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        const result = data.data || data;
        if (result.sentiment) {
          setAiSuggestedSentiment(result.sentiment);
          // AI 분석 결과를 자동으로 선택
          setSelectedSentiment(result.sentiment);
          logger.info('[IssueDetailPanel] Sentiment analyzed and auto-selected', { 
            issueId: ticket.issueId, 
            sentiment: result.sentiment 
          });
        }
      } else {
        const errorBody = await res.json().catch(() => ({}));
        logger.warn('[IssueDetailPanel] Failed to analyze sentiment', { 
          status: res.status, 
          error: errorBody 
        });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.warn('[IssueDetailPanel] Sentiment analysis timeout', { issueId: ticket.issueId });
      } else {
        logger.error('[IssueDetailPanel] Failed to analyze sentiment', { error: error.message || error });
      }
    } finally {
      setAnalyzingSentiment(false);
    }
  }, [ticket.issueId, ticket.summary, ticket.detail, ticket.projectId, token, authHeaders, selectedProjectId]);

  // 새 티켓이 열릴 때 자동으로 Sentiment 분석 (자동 분석 비활성화 - 수동 버튼 클릭만 사용)
  // useEffect(() => {
  //   // 티켓이 변경되었을 때만 분석
  //   if (ticket.issueId && lastTicketIdRef.current === ticket.issueId && (ticket.summary || ticket.detail)) {
  //     // 약간의 지연 후 분석 (상태 업데이트 완료 후)
  //     const timer = setTimeout(() => {
  //       analyzeSentiment();
  //     }, 500);
  //     
  //     return () => clearTimeout(timer);
  //   }
  // }, [ticket.issueId, ticket.summary, ticket.detail, analyzeSentiment]);

  // 공유 로그 로드
  useEffect(() => {
    const loadShareLogs = async () => {
      if (!ticket.issueId || !token) return;
      setLoadingShareLogs(true);
      try {
        const res = await fetch(`/api/issues/${ticket.issueId}/share-logs`, {
          headers: authHeaders || undefined
        });
        if (res.ok) {
          const data = await res.json();
          setShareLogs(Array.isArray(data.data) ? data.data : []);
        }
      } catch (error) {
        logger.error('Failed to load share logs', { error });
      } finally {
        setLoadingShareLogs(false);
      }
    };
    loadShareLogs();
  }, [ticket.issueId, token, authHeaders]);

  // 슬랙 채널 / 유저 목록 로드 및 폼 기본값 설정 (모달이 열릴 때)
  useEffect(() => {
    const loadSlackChannels = async () => {
      if (!showShareModal || !token) return;
      setLoadingChannels(true);
      try {
        const res = await fetch('/api/issues/slack-channels', {
          headers: authHeaders || undefined
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.data)) {
            setSlackChannels(data.data);
            // 기본값 설정 (첫 번째 채널 또는 환경 변수 기본값)
            // 봇이 멤버인 채널만 표시되므로 첫 번째 채널을 기본값으로 설정
            if (data.data.length > 0 && !selectedChannel) {
              setSelectedChannel(data.data[0].id);
              logger.info('[IssueDetailPanel] Default channel selected', { 
                channelId: data.data[0].id, 
                channelName: data.data[0].name 
              });
            } else if (data.data.length === 0) {
              logger.warn('[IssueDetailPanel] No channels available - bot may not be member of any channels');
            }
          }
        } else {
          // 채널 목록을 가져올 수 없으면 빈 배열로 설정 (Webhook 사용 시)
          setSlackChannels([]);
        }
      } catch (error) {
        logger.error('Failed to load Slack channels', { error });
        setSlackChannels([]);
      } finally {
        setLoadingChannels(false);
      }
    };

    const loadSlackUsers = async () => {
      if (!showShareModal || !token) return;
      setLoadingUsers(true);
      try {
        const res = await fetch('/api/issues/slack-users', {
          headers: authHeaders || undefined
        });
        if (res.ok) {
          const data = await res.json();
          logger.info('[IssueDetailPanel] Slack users response', { 
            success: data.success, 
            hasData: !!data.data, 
            isArray: Array.isArray(data.data),
            dataLength: Array.isArray(data.data) ? data.data.length : 0
          });
          if (data.success && Array.isArray(data.data)) {
            const users = data.data.map((u: any) => ({
              id: u.id,
              name: u.name,
              displayName: u.displayName || u.realName || u.name
            }));
            logger.info('[IssueDetailPanel] Slack users loaded', { count: users.length });
            setSlackUsers(users);
          } else {
            logger.warn('[IssueDetailPanel] Invalid Slack users response format', { data });
            setSlackUsers([]);
          }
        } else {
          const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
          logger.error('Failed to load Slack users - API error', { 
            status: res.status, 
            statusText: res.statusText,
            error: errorData 
          });
          setSlackUsers([]);
        }
      } catch (error: any) {
        logger.error('Failed to load Slack users - Network error', { 
          error: error?.message || error,
          stack: error?.stack 
        });
        setSlackUsers([]);
      } finally {
        setLoadingUsers(false);
      }
    };
    
    // 폼 기본값 설정
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
    
    // 기본값을 비워서 사용자가 직접 작성하도록 유도
    setShareForm({
      sender: ticket.assignedAgentName || user?.name || '',
      receiver: '',
      date: dateStr,
      time: timeStr,
      title: '', // 기본값 제거 - 사용자가 직접 작성
      content: '', // 기본값 제거 - 사용자가 직접 작성
      relatedUrl: ticket.link || ticket.externalSource || '',
      userInfo: ticket.assignedAgentName || '',
      testResult: ''
    });
    setSelectedUserIds([]);
    
    // 붙여넣은 이미지 미리보기 초기화
    setPastedImagePreview(null);
    
    loadSlackChannels();
    loadSlackUsers();
  }, [showShareModal, token, authHeaders, ticket.issueId, ticket.assignedAgentName, ticket.assignedAgentId, ticket.link, ticket.externalSource, user?.name, agents]); // ticket 객체 전체 대신 필요한 필드만 사용
  
  // 할당된 에이전트의 슬랙 ID를 자동 선택 (슬랙 유저 목록 로드 후 한 번만 실행)
  useEffect(() => {
    if (!showShareModal || !ticket.assignedAgentId || slackUsers.length === 0 || selectedUserIds.length > 0) return;
    
    // 할당된 에이전트 찾기
    const assignedAgent = agents.find(a => a.id === ticket.assignedAgentId);
    if (!assignedAgent || !assignedAgent.slackId) {
      logger.info('[IssueDetailPanel] No assigned agent or Slack ID', {
        assignedAgentId: ticket.assignedAgentId,
        hasAgent: !!assignedAgent,
        hasSlackId: assignedAgent?.slackId ? true : false
      });
      return;
    }
    
    // 슬랙 유저 목록에서 해당 slackId를 가진 유저 찾기
    const slackUser = slackUsers.find(u => u.id === assignedAgent.slackId);
    if (!slackUser) {
      logger.info('[IssueDetailPanel] Slack user not found', {
        slackId: assignedAgent.slackId,
        availableUsers: slackUsers.map(u => ({ id: u.id, name: u.name }))
      });
      return;
    }
    
    // 자동으로 선택
    setSelectedUserIds([slackUser.id]);
    
    // 받는 사람 필드에 멘션 텍스트 추가
    const mentionText = `@${slackUser.displayName || slackUser.name}`;
    setShareForm((prev) => ({
      ...prev,
      receiver: mentionText
    }));
    
    logger.info('[IssueDetailPanel] Auto-selected assigned agent Slack ID', {
      agentId: ticket.assignedAgentId,
      agentName: assignedAgent.name,
      slackId: assignedAgent.slackId,
      slackUserName: slackUser.displayName || slackUser.name
    });
  }, [showShareModal, ticket.assignedAgentId, slackUsers, agents]);

  // 중복 제거된 카테고리 그룹 목록 (표시용) - 이중 체크
  const uniqueCategoryGroups = useMemo(() => {
    // id 기준 중복 제거
    const idUnique = Array.from(
      new Map(categoryGroups.map((group) => [group.id, group])).values()
    );
    // name 기준 중복 제거 (같은 name이면 첫 번째 것만 유지)
    const nameUniqueMap = new Map<string, CategoryGroup>();
    for (const group of idUnique) {
      if (!nameUniqueMap.has(group.name)) {
        nameUniqueMap.set(group.name, group);
      }
    }
    const result = Array.from(nameUniqueMap.values());
    // 이름 순으로 정렬
    result.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return result;
  }, [categoryGroups]);

  // 선택된 카테고리 그룹의 카테고리 목록
  const selectedGroup = uniqueCategoryGroups.find(g => g.id === selectedCategoryGroupId);
  const availableCategories = selectedGroup?.categories || [];
  
  // 디버깅: 대분류가 선택되었는데 중분류가 없는 경우 로그
  useEffect(() => {
    if (selectedCategoryGroupId && availableCategories.length === 0 && !loadingCategories && uniqueCategoryGroups.length > 0) {
      logger.warn('[IssueDetailPanel] Selected category group has no categories', {
        selectedCategoryGroupId,
        selectedGroupName: selectedGroup?.name,
        totalGroups: uniqueCategoryGroups.length,
        groupIds: uniqueCategoryGroups.map(g => ({ id: g.id, name: g.name, categoryCount: g.categories?.length || 0 })),
        foundGroup: !!selectedGroup
      });
    }
  }, [selectedCategoryGroupId, availableCategories.length, loadingCategories, uniqueCategoryGroups.length]);
  
  // AI 제안값이 현재 로드된 카테고리 목록에 실제로 존재하는지 확인 (메모이제이션)
  const aiSuggestedCategoryGroupExists = useMemo(() => {
    return aiSuggestedCategoryGroupId ? 
      uniqueCategoryGroups.some(g => g.id === aiSuggestedCategoryGroupId) : false;
  }, [aiSuggestedCategoryGroupId, uniqueCategoryGroups]);
  
  const aiSuggestedCategoryExists = useMemo(() => {
    return aiSuggestedCategoryId && selectedCategoryGroupId ? 
      availableCategories.some(c => c.id === aiSuggestedCategoryId) : false;
  }, [aiSuggestedCategoryId, selectedCategoryGroupId, availableCategories]);

  // 카테고리 로드 완료 후, AI 제안 카테고리가 현재 프로젝트에 있으면 자동 선택
  // 단, 사용자가 이미 대분류를 선택한 경우에는 덮어쓰지 않음
  // 무한 루프 방지: 한 번만 실행되도록 ref 사용
  useEffect(() => {
    if (!loadingCategories && uniqueCategoryGroups.length > 0 && aiSuggestedCategoryGroupId && !selectedCategoryGroupId && !autoSelectGroupRef.current) {
      // AI 제안 대분류가 현재 프로젝트에 있고, 아직 대분류가 선택되지 않은 경우에만 자동 선택
      if (aiSuggestedCategoryGroupExists) {
        autoSelectGroupRef.current = true;
        logger.debug('[IssueDetailPanel] Auto-selecting AI suggested category group', {
          aiSuggestedCategoryGroupId,
          aiSuggestedCategoryId
        });
        setSelectedCategoryGroupId(aiSuggestedCategoryGroupId);
      }
    }
    // 티켓이 변경되면 ref 리셋
    if (lastTicketIdRef.current !== ticketIssueId) {
      autoSelectGroupRef.current = false;
    }
  }, [loadingCategories, uniqueCategoryGroups.length, aiSuggestedCategoryGroupId, aiSuggestedCategoryGroupExists, selectedCategoryGroupId, ticketIssueId]);

  // 선택된 대분류의 중분류 로드 후, AI 제안 중분류가 있으면 자동 선택
  // 단, 사용자가 이미 중분류를 선택한 경우에는 덮어쓰지 않음
  // 무한 루프 방지: 한 번만 실행되도록 ref 사용
  useEffect(() => {
    if (selectedCategoryGroupId && availableCategories.length > 0 && aiSuggestedCategoryId && !selectedCategoryId && !autoSelectCategoryRef.current) {
      // AI 제안 중분류가 현재 선택된 대분류에 있고, 아직 중분류가 선택되지 않은 경우에만 자동 선택
      const aiCategory = availableCategories.find(c => c.id === aiSuggestedCategoryId);
      if (aiCategory) {
        autoSelectCategoryRef.current = true;
        logger.debug('[IssueDetailPanel] Auto-selecting AI suggested category', {
          selectedCategoryGroupId,
          aiSuggestedCategoryId
        });
        setSelectedCategoryId(aiSuggestedCategoryId);
      }
    }
    // 티켓이 변경되면 ref 리셋
    if (lastTicketIdRef.current !== ticketIssueId) {
      autoSelectCategoryRef.current = false;
    }
  }, [selectedCategoryGroupId, availableCategories.length, aiSuggestedCategoryId, selectedCategoryId, ticketIssueId]);

  // 카테고리 그룹 변경 시 카테고리 초기화
  // 무한 루프 방지: 실제로 변경이 필요한 경우에만 업데이트
  useEffect(() => {
    if (selectedCategoryGroupId) {
      const group = uniqueCategoryGroups.find(g => g.id === selectedCategoryGroupId);
      if (group && group.categories.length > 0) {
        // AI 제안 카테고리가 있으면 유지, 없으면 첫 번째 카테고리 선택
        const aiCategory = group.categories.find(c => c.id === aiSuggestedCategoryId);
        if (!aiCategory && selectedCategoryId && !group.categories.find(c => c.id === selectedCategoryId)) {
          // 선택된 카테고리가 현재 그룹에 없으면 null로 설정
          setSelectedCategoryId(prev => prev !== null ? null : prev);
        }
      } else {
        // 그룹에 카테고리가 없으면 null로 설정
        setSelectedCategoryId(prev => prev !== null ? null : prev);
      }
    } else {
      // 대분류가 선택되지 않았으면 중분류도 null
      setSelectedCategoryId(prev => prev !== null ? null : prev);
    }
  }, [selectedCategoryGroupId, uniqueCategoryGroups, aiSuggestedCategoryId, selectedCategoryId]);

  // 검수 결과 저장
  const handleSaveClassification = async () => {
    if (!ticket.issueId || !token) return;
    
    // 잠금 충돌 확인
    if (lockConflict && lockConflict.locked) {
      alert(t("issueDetail.alerts.lockConflict", { name: lockConflict.lockedBy }));
      return;
    }
    
    setSaving(true);
    try {
      const updateData: any = {
        categoryGroupId: selectedCategoryGroupId || null,
        categoryId: selectedCategoryId || null,
        severity: selectedSeverity,
        sentiment: selectedSentiment,
        trend: trend.trim() || null,
        status: 'RESOLVED' // 분류 정보 저장 시 자동으로 완료 처리
      };

      const res = await fetch(`/api/issues/${ticket.issueId}`, {
        method: 'PUT',
        headers: {
          ...(authHeaders as Record<string, string>),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success || res.status === 200) {
          alert(t("issueDetail.alerts.saveOkReload"));
          // 상태 변경을 부모 컴포넌트에 알림
          onStatusChange('RESOLVED');
          // 부모 컴포넌트에 업데이트 알림 (선택사항)
          window.location.reload(); // 간단한 방법: 페이지 새로고침
        } else {
          alert(data.error || t("issueDetail.alerts.saveFailed"));
        }
      } else {
        const error = await res.json();
        alert(error.error || error.message || t("issueDetail.alerts.saveFailed"));
      }
    } catch (error) {
      logger.error('Failed to save classification', { error });
      alert(t("issueDetail.alerts.saveError"));
    } finally {
      setSaving(false);
    }
  };

  // 스크린샷 캡처 핸들러
  // 비디오 파일 업로드 핸들러
  const handleVideoUpload = async (file: File) => {
    if (!ticket.issueId || !token) return;
    
    setUploadingVideo(true);
    try {
      const formData = new FormData();
      formData.append('video', file);
      
      const res = await fetch(`/api/issues/${ticket.issueId}/upload-video`, {
        method: 'POST',
        headers: authHeaders || undefined,
        body: formData
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.data?.videoPath) {
          setVideoPath(data.data.videoPath);
          alert(t("issueDetail.alerts.videoOk"));
        }
      } else {
        const error = await res.json();
        alert(error.error || t("issueDetail.alerts.videoFailed"));
      }
    } catch (error) {
      logger.error('Failed to upload video', { error });
      alert(t("issueDetail.alerts.videoError"));
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleCaptureScreenshot = async () => {
    if (!ticket.issueId || !token) return;
    
    if (!ticket.link && !ticket.externalSource) {
      alert(t("issueDetail.alerts.noUrlScreenshot"));
      return;
    }
    
    if (!confirm(t("issueDetail.alerts.screenshotConfirm"))) {
      return;
    }
    
    setCapturingScreenshot(true);
    try {
      const res = await fetch(`/api/issues/${ticket.issueId}/capture-screenshot`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        }
      });

      const data = await res.json();
      
      if (res.ok) {
        // sendSuccess는 { success: true, data: {...} } 형식
        if (data.success || data.data) {
          alert(t("issueDetail.alerts.screenshotOk"));
          // 페이지 새로고침 또는 상태 업데이트
          window.location.reload();
        } else {
          alert(data.error || data.message || t("issueDetail.alerts.screenshotFailed"));
        }
      } else {
        // sendError는 { success: false, error: '...' } 또는 { success: false, message: '...' } 형식
        alert(data.error || data.message || t("issueDetail.alerts.screenshotFailed"));
      }
    } catch (error) {
      logger.error('Failed to capture screenshot', { error });
      alert(t("issueDetail.alerts.screenshotError"));
    } finally {
      setCapturingScreenshot(false);
    }
  };

  // 슬랙 공유 핸들러
  const handleShareToSlack = async () => {
    if (!ticket.issueId || !token) return;
    
    setSharing(true);
    try {
      // 받는 사람의 @이름을 슬랙 사용자 ID로 변환
      const mentionedUserIds: string[] = [];
      if (shareForm.receiver) {
        // selectedUserIds가 있으면 우선 사용
        if (selectedUserIds.length > 0) {
          mentionedUserIds.push(...selectedUserIds);
        } else {
          // @이름 형식을 파싱하여 사용자 ID 찾기
          const mentionPattern = /@([^\s,]+)/g;
          const matches = shareForm.receiver.matchAll(mentionPattern);
          for (const match of matches) {
            const mentionedName = match[1];
            const user = slackUsers.find(u => 
              (u.displayName || u.name) === mentionedName || 
              u.name === mentionedName
            );
            if (user) {
              mentionedUserIds.push(user.id);
            }
          }
        }
      }

      const res = await fetch(`/api/issues/${ticket.issueId}/share`, {
        method: 'POST',
        headers: {
          ...(authHeaders as Record<string, string>),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: shareTarget,
          customMessage: shareMessage.trim() || undefined,
          channel: selectedChannel || undefined,
          shareForm: shareForm, // 구조화된 폼 데이터 전송
          mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined, // 멘션할 사용자 ID 목록
          excludeImage: excludeImage, // 이미지 제외 옵션
          videoPath: videoPath || undefined // 비디오 경로
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert(t("issueDetail.alerts.slackOk"));
          setShowShareModal(false);
          setShareMessage('');
          setSelectedChannel('');
          // 공유 로그 다시 로드
          const logsRes = await fetch(`/api/issues/${ticket.issueId}/share-logs`, {
            headers: authHeaders || undefined
          });
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            setShareLogs(Array.isArray(logsData.data) ? logsData.data : []);
          }
        } else {
          alert(data.error || t("issueDetail.alerts.shareFailed"));
        }
      } else {
        const error = await res.json();
        let errorMessage = error.error || error.message || t("issueDetail.alerts.shareFailed");
        if (errorMessage.includes("not_in_channel")) {
          errorMessage = t("issueDetail.alerts.slackNotInChannel");
        } else if (errorMessage.includes("channel_not_found")) {
          errorMessage = t("issueDetail.alerts.slackChannelNotFound");
        } else if (errorMessage.includes("invalid_auth")) {
          errorMessage = t("issueDetail.alerts.slackAuthFailed");
        } else if (errorMessage.includes("missing_scope")) {
          errorMessage = t("issueDetail.alerts.slackMissingScope");
        } else if (errorMessage.includes("An API error occurred")) {
          if (errorMessage.includes("not_in_channel")) {
            errorMessage = t("issueDetail.alerts.slackNotInChannel");
          } else {
            errorMessage = t("issueDetail.alerts.slackApiError");
          }
        }
        alert(errorMessage);
      }
    } catch (error) {
      logger.error('Failed to share issue', { error });
      alert(t("issueDetail.alerts.shareError"));
    } finally {
      setSharing(false);
    }
  };

  // 원문 내용 (detail 또는 summary 사용)
  // detail이 있으면 그것만 사용, 없으면 summary 사용
  // detail이 summary를 포함하고 있을 수 있으므로, summary가 detail의 시작 부분에 있으면 제거
  // 또한 detail 내부에 중복된 내용이 있을 수 있으므로 제거
  const trendReportDisplay = useMemo(() => {
    const trd = trend.toLowerCase();
    if (!trend.trim()) return t("issueDetail.trendReport.opinion");
    if (trd.includes("건의") || trd.includes("제안") || trd.includes("suggestion"))
      return t("issueDetail.trendReport.suggestion");
    if (trd.includes("문의") || trd.includes("질문") || trd.includes("inquiry"))
      return t("issueDetail.trendReport.inquiry");
    if (trd.includes("제보") || trd.includes("신고") || trd.includes("report"))
      return t("issueDetail.trendReport.report");
    return t("issueDetail.trendReport.opinion");
  }, [trend, t]);

  const originalTitle = ticket.summary || ticket.title || '';
  
  let originalContent = '';
  
  // detail 내부의 중복 제거 함수
  const removeDuplicateContent = (text: string): string => {
    if (!text || typeof text !== 'string') return text;
    
    const trimmed = text.trim();
    if (!trimmed) return text;
    
    // 1. 같은 줄이 연속으로 반복되는 경우 제거
    const lines = trimmed.split('\n');
    const uniqueLines: string[] = [];
    let lastLine = '';
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      // 빈 줄은 유지하되, 같은 내용이 연속으로 반복되는 경우는 제거
      if (trimmedLine && trimmedLine === lastLine) {
        continue; // 중복 줄 건너뛰기
      }
      uniqueLines.push(line);
      if (trimmedLine) {
        lastLine = trimmedLine;
      }
    }
    
    let deduplicated = uniqueLines.join('\n');
    
    // 2. 전체 텍스트가 반복되는 경우 (예: "A\nA" 또는 "A\n\nA")
    const halfLength = Math.floor(deduplicated.length / 2);
    const firstHalf = deduplicated.substring(0, halfLength).trim();
    const secondHalf = deduplicated.substring(halfLength).trim();
    
    // 첫 절반과 두 번째 절반이 거의 같으면 (공백/줄바꿈 차이만 있으면) 첫 절반만 사용
    if (firstHalf && secondHalf && firstHalf.length > 10) {
      const normalizedFirst = firstHalf.replace(/\s+/g, ' ').trim();
      const normalizedSecond = secondHalf.replace(/\s+/g, ' ').trim();
      if (normalizedFirst === normalizedSecond) {
        deduplicated = firstHalf;
      }
    }
    
    // 3. 같은 문장이 반복되는 경우 (줄바꿈으로 구분)
    const sentences = deduplicated.split(/\n+/);
    const uniqueSentences: string[] = [];
    const seenSentences = new Set<string>();
    
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) {
        // 빈 줄은 유지 (단, 연속된 빈 줄은 하나로)
        if (uniqueSentences.length === 0 || uniqueSentences[uniqueSentences.length - 1] !== '') {
          uniqueSentences.push('');
        }
        continue;
      }
      
      // 정규화된 문장으로 중복 체크
      const normalized = trimmedSentence.replace(/\s+/g, ' ').trim();
      if (!seenSentences.has(normalized)) {
        seenSentences.add(normalized);
        uniqueSentences.push(trimmedSentence);
      }
    }
    
    return uniqueSentences.join('\n').trim();
  };
  
  if (ticket.detail) {
    // detail이 있으면 detail 사용
    let detailContent = ticket.detail;
    
    // [KEYWORD_MATCHED] 마커 제거 (표시용)
    if (detailContent.startsWith('[KEYWORD_MATCHED]\n')) {
      detailContent = detailContent.substring('[KEYWORD_MATCHED]\n'.length);
    } else if (detailContent === '[KEYWORD_MATCHED]') {
      detailContent = '';
    }
    
    // 먼저 detail 내부의 중복 제거
    detailContent = removeDuplicateContent(detailContent);
    
    // detail이 summary를 포함하고 있는 경우, 중복 제거
    // 단, detail이 summary와 정확히 동일하거나 summary만 있는 경우는 detail 전체를 표시
    if (ticket.summary && ticket.summary.trim()) {
      const summaryText = ticket.summary.trim();
      const detailText = detailContent.trim();
      
      // detail이 summary와 정확히 동일한 경우, detail 전체를 표시 (본문이 제목과 동일한 경우도 본문으로 표시)
      if (detailText === summaryText) {
        originalContent = detailText;
      }
      // summary가 detail의 시작 부분에 정확히 있는 경우 제거
      else if (detailText.startsWith(summaryText)) {
        // summary로 시작하는 경우, summary 길이만큼 제거
        let afterSummary = detailText.substring(summaryText.length).trim();
        
        // 줄바꿈이 여러 개 있으면 정리
        afterSummary = afterSummary.replace(/\n{3,}/g, '\n\n');
        
        // 제거 후 남은 내용이 3자 이상이면 사용, 그렇지 않으면 detail 전체 사용
        if (afterSummary.length >= 3) {
          originalContent = afterSummary;
        } else {
          // 제거 후 남은 내용이 없거나 너무 짧으면 detail 전체 사용
          originalContent = detailText;
        }
      } else if (detailText.includes(summaryText)) {
        // summary가 중간이나 끝에 있는 경우, 첫 번째 발생 위치에서만 제거
        const summaryIndex = detailText.indexOf(summaryText);
        if (summaryIndex !== -1) {
          // summary 앞부분과 뒷부분을 합침
          const before = detailText.substring(0, summaryIndex).trim();
          const after = detailText.substring(summaryIndex + summaryText.length).trim();
          
          // 둘 다 있으면 줄바꿈으로 연결, 하나만 있으면 그대로 사용
          if (before && after) {
            originalContent = (before + '\n\n' + after).trim();
          } else {
            const result = (before || after).trim();
            // 결과가 3자 이상이면 사용, 그렇지 않으면 detail 전체 사용
            originalContent = result.length >= 3 ? result : detailText;
          }
        } else {
          originalContent = detailText;
        }
      } else {
        // summary가 포함되지 않으면 detail 그대로 사용
        originalContent = detailText;
      }
    } else {
      // summary가 없으면 detail 그대로 사용 (이미 중복 제거됨)
      originalContent = detailContent.trim();
    }
  } else if (ticket.summary) {
    // detail이 없으면 summary 사용
    originalContent = removeDuplicateContent(ticket.summary).trim();
  } else {
    // 둘 다 없으면 title 사용
    originalContent = removeDuplicateContent(ticket.title || '').trim();
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 flex justify-end">
      <div className="w-full md:max-w-6xl h-full bg-white dark:bg-slate-800 shadow-xl border-l border-slate-200 dark:border-slate-700 flex flex-col">
        {/* 잠금 경고 메시지 */}
        {lockConflict && lockConflict.locked && (
          <div className="px-6 py-3 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3">
            <span className="text-2xl">🔒</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t("issueDetail.lock.bannerBeforeName")}
                <strong>{lockConflict.lockedBy}</strong>
                {t("issueDetail.lock.bannerAfterName")}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                {t("issueDetail.lock.bannerLine2")}
              </p>
            </div>
          </div>
        )}
        
        {/* 잠금 획득 중 로딩 */}
        {acquiringLock && !lockConflict && (
          <div className="px-6 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <p className="text-sm text-blue-700 dark:text-blue-300">{t("issueDetail.lock.checking")}</p>
          </div>
        )}
        
        {/* 헤더 */}
        <div className="flex items-start justify-between px-6 py-4 border-b dark:border-slate-700 gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase text-slate-400 dark:text-slate-500 tracking-wide">{t("issueDetail.header.subtitle")}</p>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 truncate" title={ticket.title}>
              {ticket.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* 이미지 존재 여부 표시 */}
            {(ticket as any).hasImages !== undefined ? (
              <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm rounded-lg flex items-center gap-1.5">
                {(ticket as any).hasImages || Boolean(discourseImageUrl) ? (
                  <>
                    <span>🖼️</span>
                    <span>{t("issueDetail.image.present")}</span>
                  </>
                ) : (
                  <>
                    <span>📄</span>
                    <span>{t("issueDetail.image.absent")}</span>
                  </>
                )}
              </div>
            ) : (
              <div
                className="px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm rounded-lg flex items-center gap-1.5"
                title={t("issueDetail.image.unknownTitle")}
              >
                <span>❓</span>
                <span>{t("issueDetail.image.unknown")}</span>
              </div>
            )}
            {displayPostImagePaths.length === 0 && (ticket.link || (ticket as any).sourceUrl) && (
              <button
                onClick={handleCaptureScreenshot}
                disabled={capturingScreenshot}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("issueDetail.image.captureTitle")}
              >
                <span>📸</span>
                <span>{capturingScreenshot ? t("issueDetail.image.capturing") : t("issueDetail.image.capture")}</span>
              </button>
            )}
            <button
              onClick={() => setShowShareModal(true)}
              className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1.5"
            >
              <span>⚡</span>
              <span>{t("issueDetail.slackShare")}</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm whitespace-nowrap"
            >
              {t("issueDetail.header.close")}
            </button>
          </div>
        </div>

        {/* Split View: 좌우 분할 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 왼쪽: 원문 영역 */}
          <div className="w-1/2 border-r dark:border-slate-700 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t("issueDetail.original.title")}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("issueDetail.original.hint")}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* 원문 제목 */}
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase mb-1">{t("issueDetail.original.fieldTitle")}</p>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                    {originalTitle}
                  </p>
                </div>
              </div>

              {/* 원문 본문 */}
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase mb-1">{t("issueDetail.original.fieldBody")}</p>
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700 min-h-[200px]">
                  {(() => {
                    try {
                      if (!originalContent || typeof originalContent !== 'string') {
                        return <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{t("issueDetail.original.empty")}</p>;
                      }
                      
                      // "댓글" 또는 "URL 복사" 텍스트가 나타나는 위치 찾기
                      const commentPattern = /댓글\s*\d*\s*URL 복사/i;
                      const urlCopyIndex = originalContent.indexOf('URL 복사');
                      const commentMatch = originalContent.match(commentPattern);
                      
                      let visibleContent = originalContent;
                      
                      if (commentMatch && commentMatch.index !== undefined) {
                        // "댓글 *URL 복사" 패턴이 있으면 그 이후 내용만 표시
                        const matchIndex = commentMatch.index;
                        const matchEnd = matchIndex + commentMatch[0].length;
                        visibleContent = originalContent.substring(matchEnd).trim();
                      } else if (urlCopyIndex !== -1) {
                        // "URL 복사"만 있으면 그 이후 내용만 표시
                        visibleContent = originalContent.substring(urlCopyIndex + 'URL 복사'.length).trim();
                      }
                      
                      // 빈 내용이면 메시지 표시 (본문 없이 이미지만 있는 경우 등)
                      if (!visibleContent || !visibleContent.trim()) {
                        return <p className="text-sm text-slate-500 dark:text-slate-400">{t("issueDetail.original.empty")}</p>;
                      }
                      
                      return (
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                          {visibleContent}
                        </p>
                      );
                    } catch (error) {
                      logger.error('Error rendering content', { error });
                      return (
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                          {originalContent || t("issueDetail.original.empty")}
                        </p>
                      );
                    }
                  })()}
                </div>
              </div>

              {/* 게시글 이미지 (다중 경로 + 단일 스크린샷) */}
              {displayPostImagePaths.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 uppercase mb-1">{t("issueDetail.original.captureHeading")}</p>
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700 space-y-3">
                    {displayPostImagePaths.map((p) => (
                      <ScreenshotImage key={p} screenshotPath={p} />
                    ))}
                    <p className="text-xs text-slate-400 dark:text-slate-500">{t("issueDetail.original.captureClickHint")}</p>
                  </div>
                </div>
              )}

              {/* Discourse 대표 이미지 (캡처가 없어도 표시). 여러 이미지가 있으면 캡처가 더 정확함 */}
              {displayPostImagePaths.length === 0 && discourseImageUrl && (
                <div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 uppercase mb-1">대표 이미지</p>
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                    <img
                      src={discourseImageUrl}
                      alt="대표 이미지"
                      className="w-full max-h-[420px] object-contain rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(discourseImageUrl, "_blank")}
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                      클릭하면 원본 이미지를 새 창으로 엽니다. (여러 장이면 상단의 📸 캡처를 권장)
                    </p>
                  </div>
                </div>
              )}

              {/* 원문 메타 정보 */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400 dark:text-slate-500 uppercase mb-1">{t("issueDetail.original.source")}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{ticket.source}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-slate-500 uppercase mb-1">{t("issueDetail.original.createdAt")}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{formatDate(ticket.createdAt)}</p>
                </div>
                {ticket.requiresLogin && (
                  <div className="col-span-2">
                    <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-red-600 dark:text-red-400">🔒</span>
                        <span className="text-sm font-semibold text-red-700 dark:text-red-300">{t("issueDetail.original.loginRequiredBadge")}</span>
                      </div>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t("issueDetail.original.loginRequiredHint")}</p>
                    </div>
                  </div>
                )}
                {ticket.link && (
                  <div className="col-span-2">
                    <a
                      href={ticket.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {t("issueDetail.original.openOriginal")}
                    </a>
                  </div>
                )}
                {token && ticket.issueId && isNaverCafeArticleUrl(ticket.link) && (
                  <div className="col-span-2 mt-2 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/40">
                    <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-200 mb-2">
                      {t("issueDetail.commentWatch.title")}
                    </p>
                    {commentWatchLoading ? (
                      <p className="text-xs text-slate-500">{t("issueDetail.commentWatch.loadingSettings")}</p>
                    ) : (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={Boolean(commentWatch?.enabled)}
                            disabled={commentWatchSaving}
                            onChange={async (e) => {
                              if (!ticket.issueId) return;
                              setCommentWatchSaving(true);
                              try {
                                const projectId = ticket.projectId ?? selectedProjectId;
                                const path = commentWatchApiPath(ticket.issueId, projectId);
                                const res = await fetch(path, {
                                  method: "PATCH",
                                  headers: {
                                    ...(authHeaders as Record<string, string>),
                                    "Content-Type": "application/json"
                                  },
                                  body: JSON.stringify({
                                    enabled: e.target.checked,
                                    intervalMinutes: watchIntervalMinutes
                                  })
                                });
                                if (res.ok) {
                                  const body = await res.json();
                                  const data = body.data ?? body;
                                  setCommentWatch(data.watch);
                                } else {
                                  logger.error("[IssueDetailPanel] comment-watch failed", { status: res.status, path });
                                }
                              } finally {
                                setCommentWatchSaving(false);
                              }
                            }}
                          />
                          {t("issueDetail.commentWatch.description")}
                        </label>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.commentWatch.interval")}</span>
                          <select
                            className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                            value={watchIntervalMinutes}
                            disabled={commentWatchSaving}
                            onChange={(ev) => setWatchIntervalMinutes(Number(ev.target.value))}
                          >
                            <option value={5}>{t("issueDetail.commentWatch.minutesOption", { count: 5 })}</option>
                            <option value={10}>{t("issueDetail.commentWatch.minutesOption", { count: 10 })}</option>
                            <option value={15}>{t("issueDetail.commentWatch.minutesOption", { count: 15 })}</option>
                            <option value={30}>{t("issueDetail.commentWatch.minutesOption", { count: 30 })}</option>
                            <option value={60}>{t("issueDetail.commentWatch.minutesOption", { count: 60 })}</option>
                            <option value={120}>{t("issueDetail.commentWatch.minutesOption", { count: 120 })}</option>
                          </select>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-50"
                            disabled={commentWatchSaving || !commentWatch?.enabled}
                            onClick={async () => {
                              if (!ticket.issueId) return;
                              setCommentWatchSaving(true);
                              try {
                                const projectId = ticket.projectId ?? selectedProjectId;
                                const path = commentWatchApiPath(ticket.issueId, projectId);
                                const res = await fetch(path, {
                                  method: "PATCH",
                                  headers: {
                                    ...(authHeaders as Record<string, string>),
                                    "Content-Type": "application/json"
                                  },
                                  body: JSON.stringify({
                                    enabled: true,
                                    intervalMinutes: watchIntervalMinutes
                                  })
                                });
                                if (res.ok) {
                                  const body = await res.json();
                                  const data = body.data ?? body;
                                  setCommentWatch(data.watch);
                                } else {
                                  logger.error("[IssueDetailPanel] comment-watch interval PATCH failed", {
                                    status: res.status,
                                    path
                                  });
                                }
                              } finally {
                                setCommentWatchSaving(false);
                              }
                            }}
                          >
                            {t("issueDetail.commentWatch.apply")}
                          </button>
                        </div>
                        {commentWatch?.lastError && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            {t("issueDetail.commentWatch.lastError", { message: commentWatch.lastError })}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t("issueDetail.commentWatch.workerHint")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 오른쪽: 분석 및 처리 영역 */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t("issueDetail.review.title")}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("issueDetail.review.hint")}</p>
            </div>
            
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* 이미지 존재 여부 정보 */}
              {(ticket as any).hasImages !== undefined ? (
                <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">{t("issueDetail.review.postImageLabel")}</span>
                    {(ticket as any).hasImages || Boolean(discourseImageUrl) ? (
                      <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded-full flex items-center gap-1">
                        <span>🖼️</span>
                        <span>{t("issueDetail.image.present")}</span>
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs rounded-full flex items-center gap-1">
                        <span>📄</span>
                        <span>{t("issueDetail.image.absent")}</span>
                      </span>
                    )}
                    {displayPostImagePaths.length > 0 && (
                      <span className="ml-auto px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                        📸 {t("issueDetail.review.captured")}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase">{t("issueDetail.review.postImageLabel")}</span>
                    <span className="px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs rounded-full flex items-center gap-1" title={t("issueDetail.image.unknownTitle")}>
                      <span>❓</span>
                      <span>{t("issueDetail.image.unknown")}</span>
                    </span>
                    {displayPostImagePaths.length > 0 && (
                      <span className="ml-auto px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                        📸 {t("issueDetail.review.captured")}
                      </span>
                    )}
                  </div>
                </div>
              )}
              
              {/* AI 분류 정보 배지 */}
              {ticket.aiClassificationMethod && (
                <div className="p-3 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-700 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase">
                      {ticket.aiClassificationMethod === "AI"
                        ? `🤖 ${t("issueDetail.review.aiClassified")}`
                        : `📋 ${t("issueDetail.review.ruleClassified")}`}
                    </span>
                    {ticket.aiClassificationMethod === 'AI' && (
                      <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                        AI
                      </span>
                    )}
                  </div>
                  {ticket.aiClassificationReason && (
                    <div className="space-y-2">
                      {editingAiReason ? (
                        <div className="space-y-2">
                          <textarea
                            value={aiClassificationReason}
                            onChange={(e) => setAiClassificationReason(e.target.value)}
                            className="w-full px-3 py-2 border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-purple-500 text-sm"
                            rows={3}
                            placeholder={t("issueDetail.review.aiReasonPlaceholder")}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                if (!ticket.issueId) return;
                                setSaving(true);
                                try {
                                  const res = await fetch(`/api/issues/${ticket.issueId}`, {
                                    method: 'PUT',
                                    headers: {
                                      ...authHeaders,
                                      'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                      aiClassificationReason: aiClassificationReason.trim() || null
                                    })
                                  });
                                  if (res.ok) {
                                    // 저장 성공 시 편집 모드만 종료하고 로컬 상태 업데이트
                                    const updatedData = await res.json();
                                    if (updatedData.data && updatedData.data.aiClassificationReason !== undefined) {
                                      setAiClassificationReason(updatedData.data.aiClassificationReason || '');
                                    }
                                    setEditingAiReason(false);
                                  } else {
                                    alert(t("issueDetail.review.saveFailed"));
                                  }
                                } catch (error) {
                                  logger.error('Failed to update AI reason', { error });
                                  alert(t("issueDetail.review.saveError"));
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                            >
                              {t("issueDetail.review.save")}
                            </button>
                            <button
                              onClick={() => {
                                setAiClassificationReason(ticket.aiClassificationReason || '');
                                setEditingAiReason(false);
                              }}
                              disabled={saving}
                              className="px-3 py-1.5 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300 disabled:opacity-50"
                            >
                              {t("issueDetail.review.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed flex-1">
                            {aiClassificationReason}
                          </p>
                          <button
                            onClick={() => setEditingAiReason(true)}
                            className="px-2 py-1 text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800 flex-shrink-0"
                            title={t("issueDetail.review.editAiSummaryTitle")}
                          >
                            {t("issueDetail.review.edit")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 대분류 선택 */}
              <div>
                <label className="block text-xs font-medium mb-2 text-slate-700 dark:text-slate-300">
                  {t("issueDetail.category.groupRequired")}
                  {aiSuggestedCategoryGroupId && aiSuggestedCategoryGroupExists && aiSuggestedCategoryGroupId === selectedCategoryGroupId && (
                    <span className="ml-2 px-2 py-0.5 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                      🤖 {t("issueDetail.category.aiSuggested")}
                    </span>
                  )}
                </label>
                {loadingCategories ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">{t("issueDetail.category.loading")}</div>
                ) : (
                  <select
                    value={selectedCategoryGroupId || ''}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedCategoryGroupId(e.target.value ? parseInt(e.target.value) : null)}
                    disabled={!!(lockConflict && lockConflict.locked)}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:cursor-not-allowed"
                  >
                    <option value="">{t("issueDetail.category.selectPlaceholder")}</option>
                    {uniqueCategoryGroups.map((group, index) => (
                      <option key={`category-group-${group.id}-${index}`} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                )}
                {aiSuggestedCategoryGroupId && (
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    {t("issueDetail.category.aiSuggestion", {
                      label: aiSuggestedCategoryGroupExists
                        ? uniqueCategoryGroups.find((g) => g.id === aiSuggestedCategoryGroupId)?.name ||
                          ticket.categoryGroupName ||
                          t("issueDetail.category.unknownCategory")
                        : ticket.categoryGroupName || t("issueDetail.category.otherProjectCategory")
                    })}
                  </p>
                )}
              </div>

              {/* 중분류 선택 */}
              <div>
                <label className="block text-xs font-medium mb-2 text-slate-700 dark:text-slate-300">
                  {t("issueDetail.category.itemRequired")}
                  {selectedCategoryGroupId && aiSuggestedCategoryId && aiSuggestedCategoryExists && aiSuggestedCategoryId === selectedCategoryId && (
                    <span className="ml-2 px-2 py-0.5 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                      🤖 {t("issueDetail.category.aiSuggested")}
                    </span>
                  )}
                </label>
                <select
                  value={selectedCategoryId || ''}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedCategoryId(e.target.value ? parseInt(e.target.value) : null)}
                  disabled={!selectedCategoryGroupId || loadingCategories || (availableCategories.length === 0 && !!selectedGroup) || !!(lockConflict && lockConflict.locked)}
                  className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:cursor-not-allowed"
                >
                  {!selectedCategoryGroupId ? (
                    <option value="">{t("issueDetail.category.selectGroupFirst")}</option>
                  ) : loadingCategories ? (
                    <option value="">{t("issueDetail.category.loading")}</option>
                  ) : availableCategories.length === 0 ? (
                    <option value="">{t("issueDetail.category.noSubcategories")}</option>
                  ) : (
                    <>
                      <option value="">{t("issueDetail.category.selectPlaceholder")}</option>
                      {availableCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {selectedCategoryGroupId && availableCategories.length === 0 && !loadingCategories && selectedGroup && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    {t("issueDetail.category.noSubcategoriesAdmin", { name: selectedGroup.name })}
                  </p>
                )}
                {selectedCategoryGroupId && aiSuggestedCategoryId && (
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    {t("issueDetail.category.aiSuggestion", {
                      label: aiSuggestedCategoryExists
                        ? availableCategories.find((c) => c.id === aiSuggestedCategoryId)?.name ||
                          ticket.categoryName ||
                          t("issueDetail.category.unknownCategory")
                        : ticket.categoryName || t("issueDetail.category.otherProjectCategory")
                    })}
                  </p>
                )}
              </div>

              {/* 중요도 (Severity) */}
              <div>
                <label className="block text-xs font-medium mb-2 text-slate-700 dark:text-slate-300">
                  {t("issueDetail.severity.label")}
                  {aiSuggestedSeverity === selectedSeverity && (
                    <span className="ml-2 px-2 py-0.5 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                      🤖 {t("issueDetail.category.aiSuggested")}
                    </span>
                  )}
                </label>
                <div className="flex gap-3">
                  {[1, 2, 3].map((sev) => {
                    const isSelected = selectedSeverity === sev;
                    const isAiSuggested = aiSuggestedSeverity === sev;
                    const colorClass = sev === 1 
                      ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300'
                      : sev === 2
                      ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300'
                      : 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300';
                    
                    return (
                      <label
                        key={sev}
                        className={`flex-1 p-3 border-2 rounded-lg transition-all ${
                          (lockConflict && lockConflict.locked) 
                            ? 'opacity-50 cursor-not-allowed' 
                            : 'cursor-pointer'
                        } ${
                          isSelected 
                            ? `${colorClass} ring-2 ring-blue-500` 
                            : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name="severity"
                          value={sev}
                          checked={isSelected}
                          onChange={() => setSelectedSeverity(sev)}
                          disabled={!!(lockConflict && lockConflict.locked)}
                          className="sr-only"
                        />
                        <div className="text-center">
                          <div className="font-bold text-lg">Sev{sev}</div>
                          <div className="text-xs mt-1">
                            {sev === 1
                              ? t("issueDetail.severity.sev1")
                              : sev === 2
                                ? t("issueDetail.severity.sev2")
                                : t("issueDetail.severity.sev3")}
                          </div>
                          {isAiSuggested && (
                            <div className="text-xs mt-1 text-purple-600 dark:text-purple-400">
                              🤖 {t("issueDetail.severity.aiShort")}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 성향 (Sentiment) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t("issueDetail.sentiment.label")}
                    {aiSuggestedSentiment && aiSuggestedSentiment === selectedSentiment && (
                      <span className="ml-2 px-2 py-0.5 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                        🤖 {t("issueDetail.category.aiSuggested")}
                      </span>
                    )}
                    {analyzingSentiment && (
                      <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                        {t("issueDetail.sentiment.analyzing")}
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={analyzeSentiment}
                    disabled={analyzingSentiment || (lockConflict && lockConflict.locked) || !ticket.issueId}
                    className="px-4 py-1.5 text-sm font-medium bg-purple-500 dark:bg-purple-600 text-white rounded-lg hover:bg-purple-600 dark:hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md flex items-center gap-1.5"
                    title={t("issueDetail.sentiment.analyzeTitle")}
                  >
                    {analyzingSentiment ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        <span>{t("issueDetail.sentiment.analyzing")}</span>
                      </>
                    ) : (
                      <>
                        <span>🤖</span>
                        <span>{t("issueDetail.sentiment.analyze")}</span>
                      </>
                    )}
                  </button>
                </div>
                <select
                  value={selectedSentiment}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedSentiment(e.target.value)}
                  disabled={!!(lockConflict && lockConflict.locked)}
                  className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:cursor-not-allowed"
                >
                  <option value="pos">{t("issueDetail.sentiment.pos")}</option>
                  <option value="neu">{t("issueDetail.sentiment.neu")}</option>
                  <option value="neg">{t("issueDetail.sentiment.neg")}</option>
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("issueDetail.sentiment.reportHint")}</p>
                {aiSuggestedSentiment && aiSuggestedSentiment !== selectedSentiment && (
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    💡 {t("issueDetail.sentiment.aiHint", { label: sentimentLabelShort(aiSuggestedSentiment) })}
                  </p>
                )}
              </div>

              {/* 동향 (Trend) */}
              <div>
                <label className="block text-xs font-medium mb-2 text-slate-700 dark:text-slate-300">
                  {t("issueDetail.trend.label")}
                  {aiSuggestedTrend && (
                    <span className="ml-2 px-2 py-0.5 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                      🤖 {t("issueDetail.trend.aiSuggested", { value: aiSuggestedTrend })}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={trend}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const value = e.target.value;
                    // 3단어 이내로 제한
                    const words = value.trim().split(/\s+/);
                    if (words.length <= 3) {
                      setTrend(value);
                    } else {
                      setTrend(words.slice(0, 3).join(' '));
                    }
                  }}
                  disabled={!!(lockConflict && lockConflict.locked)}
                  placeholder={t("issueDetail.trend.placeholder")}
                  maxLength={50}
                  className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                />
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("issueDetail.trend.wordCount", { current: trend.trim().split(/\s+/).filter(Boolean).length })}
                  </p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t("issueDetail.trend.reportLabel")}{" "}
                    <span className="text-blue-600 dark:text-blue-400">{trendReportDisplay}</span>
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("issueDetail.trend.reportHint")}</p>
              </div>

              {/* 보고서 반영 미리보기 */}
              <div className="pt-4 border-t dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="w-full px-4 py-2 text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                >
                  <span>📊 {t("issueDetail.preview.toggle")}</span>
                  <span className={`transform transition-transform ${showPreview ? 'rotate-180' : ''}`}>▼</span>
                </button>
                
                {showPreview && (
                  <div className="mt-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                    <h4 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-3">{t("issueDetail.preview.heading")}</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.preview.group")}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {uniqueCategoryGroups.find(g => g.id === selectedCategoryGroupId)?.name || t("issueDetail.preview.notSelected")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.preview.item")}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {availableCategories.find(c => c.id === selectedCategoryId)?.name || t("issueDetail.preview.notSelected")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.preview.trend")}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{trendReportDisplay}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.preview.sentiment")}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {sentimentLabelShort(selectedSentiment)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.preview.severity")}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {selectedSeverity === 1
                            ? t("issueDetail.preview.severityHigh")
                            : selectedSeverity === 2
                              ? t("issueDetail.preview.severityMid")
                              : t("issueDetail.preview.severityLow")}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 pt-3 border-t border-blue-200 dark:border-blue-700">
                      💡 {t("issueDetail.preview.footer")}
                    </p>
                  </div>
                )}
              </div>

              {/* 저장 버튼 */}
              <div className="pt-4 border-t dark:border-slate-700">
                <button
                  onClick={handleSaveClassification}
                  disabled={saving || !selectedCategoryGroupId || !selectedCategoryId || !!(lockConflict && lockConflict.locked)}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  {saving
                    ? t("issueDetail.save.saving")
                    : lockConflict && lockConflict.locked
                      ? t("issueDetail.lock.readOnlyButton")
                      : t("issueDetail.save.button")}
                </button>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
                  {lockConflict && lockConflict.locked
                    ? t("issueDetail.lock.footerReviewing", { name: lockConflict.lockedBy })
                    : t("issueDetail.save.requiredHint")}
                </p>
              </div>

              {/* 기본 정보 */}
              <div className="pt-4 border-t dark:border-slate-700 space-y-3">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 uppercase block mb-1">{t("issueDetail.status.label")}</label>
                  <select
                    className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    value={(() => {
                      const s = (ticket.status || 'OPEN') as IssueWorkflowStatus;
                      if (s === 'WAITING') return 'IN_PROGRESS';
                      if (s === 'VERIFIED') return 'RESOLVED';
                      return STATUS_OPTIONS.includes(s) ? s : 'OPEN';
                    })()}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => onStatusChange(event.target.value as IssueWorkflowStatus)}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {t(`issueDetail.status.${status}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 uppercase block mb-1">{t("issueDetail.assignee.label")}</label>
                  <select
                    className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    value={ticket.assignedAgentId || ""}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => onAssignAgent(event.target.value)}
                  >
                    <option value="">{t("issueDetail.assignee.unassigned")}</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} ({agent.email || agent.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 공유 이력 섹션 */}
              {shareLogs.length > 0 && (
                <div className="pt-4 border-t dark:border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t("issueDetail.shareLog.title")}</h3>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {shareLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center gap-2 text-xs p-2 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700"
                      >
                        <span className="text-purple-600 dark:text-purple-400">📢</span>
                        <span className="text-slate-600 dark:text-slate-400">
                          {new Date(log.sentAt).toLocaleString(dateLocale, {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Seoul"
                          })}
                        </span>
                        <span className="text-slate-700 dark:text-slate-300">
                          {t("issueDetail.shareLog.sharedSlack", {
                            name: log.agentName || t("issueDetail.shareLog.bySystem")
                          })}
                        </span>
                        {log.status === 'FAILED' && (
                          <span className="text-red-600 dark:text-red-400 text-xs">{t("issueDetail.shareLog.failed")}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 코멘트 섹션 */}
              <div className="pt-4 border-t dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t("issueDetail.comments.title")}</h3>
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {commentsLoading && <p className="text-xs text-slate-500 dark:text-slate-400">{t("issueDetail.comments.loading")}</p>}
                  {!commentsLoading && comments.length === 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("issueDetail.comments.empty")}</p>
                  )}
                  {comments.map((comment) => (
                    <div key={comment.id} className="border dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-900">
                      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                        <span>{comment.authorName || t("issueDetail.comments.authorSystem")}</span>
                        <span>{new Date(comment.createdAt).toLocaleString(dateLocale, { timeZone: "Asia/Seoul" })}</span>
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{comment.body}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring focus:ring-blue-100 dark:focus:ring-blue-900 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    rows={3}
                    placeholder={t("issueDetail.comments.placeholder")}
                    value={newComment}
                    onChange={(event) => onCommentChange(event.target.value)}
                  />
                  <button
                    onClick={onSubmitComment}
                    disabled={!newComment.trim() || submittingComment}
                    className="w-full bg-blue-600 text-white text-sm py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {submittingComment ? t("issueDetail.comments.submitting") : t("issueDetail.comments.submit")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 슬랙 공유 미리보기 모달 */}
      {showShareModal && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center"
          onPaste={async (e) => {
            e.preventDefault();
            const items = e.clipboardData.items;
            
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                if (file && ticket.issueId) {
                  // 미리보기 생성
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    setPastedImagePreview(e.target?.result as string);
                  };
                  reader.readAsDataURL(file);
                  
                  // 서버에 업로드
                  setUploadingImage(true);
                  try {
                    const formData = new FormData();
                    formData.append('image', file);
                    
                    const res = await fetch(`/api/issues/${ticket.issueId}/upload-image`, {
                      method: 'POST',
                      headers: authHeaders,
                      body: formData
                    });
                    
                    if (res.ok) {
                      const data = await res.json();
                      // 로컬 상태 업데이트 (페이지 새로고침 없이)
                      if (data.data?.screenshotPath) {
                        setLocalScreenshotPath(data.data.screenshotPath);
                        // localScreenshotPath가 설정되면 pastedImagePreview는 자동으로 무시됨 (UI에서 localScreenshotPath 우선 표시)
                        // pastedImagePreview는 유지하여 사용자가 확인할 수 있도록 함
                      }
                      alert(t("issueDetail.alerts.imageUploaded"));
                    } else {
                      const error = await res.json();
                      alert(error.error || t("issueDetail.shareModal.imageUploadErrorFallback"));
                      setPastedImagePreview(null);
                    }
                  } catch (error) {
                    logger.error('Failed to upload image', { error });
                    alert(t("issueDetail.alerts.imageUploadFailed"));
                    setPastedImagePreview(null);
                  } finally {
                    setUploadingImage(false);
                  }
                  break;
                }
              }
            }
          }}
          tabIndex={-1}
        >
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border dark:border-slate-700 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("issueDetail.shareModal.title")}</h3>
                <button
                  onClick={() => {
                    setShowShareModal(false);
                    setShareMessage('');
                    setSelectedChannel('');
                    setPastedImagePreview(null);
                    // 모달 닫을 때는 localScreenshotPath 유지 (이미 업로드된 이미지이므로)
                  }}
                  className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              {/* 구조화된 공유 폼 */}
              <div className="space-y-4 mb-4 max-h-[60vh] overflow-y-auto pr-2">
                {/* 보내는 사람 / 받는 사람 (@태그) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t("issueDetail.shareModal.senderLabel")}
                    </label>
                    <input
                      type="text"
                      value={shareForm.sender}
                      onChange={(e) => setShareForm({ ...shareForm, sender: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                      placeholder={t("issueDetail.shareModal.senderPlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t("issueDetail.shareModal.receiverLabel")}
                    </label>
                    <input
                      type="text"
                      value={shareForm.receiver}
                      onChange={(e) => setShareForm({ ...shareForm, receiver: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 mb-1"
                      placeholder={t("issueDetail.shareModal.receiverPlaceholder")}
                    />
                    <div className="mt-1">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        {t("issueDetail.shareModal.slackUserPicker")}
                      </label>
                      <div className="w-full max-h-32 overflow-y-auto border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 p-2 space-y-1">
                        {loadingUsers && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 py-2 text-center">
                            {t("issueDetail.shareModal.loadingSlackUsers")}
                          </div>
                        )}
                        {!loadingUsers && slackUsers.length === 0 && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 py-2 text-center">
                            {showShareModal ? t("issueDetail.shareModal.noSlackUsers") : t("issueDetail.shareModal.slackUsersError")}
                          </div>
                        )}
                        {!loadingUsers && slackUsers.length > 0 && slackUsers.map((user) => (
                          <label
                            key={user.id}
                            className="flex items-center space-x-2 px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer text-xs text-slate-700 dark:text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={selectedUserIds.includes(user.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const newSelected = [...selectedUserIds, user.id];
                                  setSelectedUserIds(newSelected);
                                  const selected = slackUsers.filter((u) => newSelected.includes(u.id));
                                  const mentionText = selected.map((u) => `@${u.displayName || u.name}`).join(', ');
                                  setShareForm((prev) => ({
                                    ...prev,
                                    receiver: mentionText
                                  }));
                                } else {
                                  const newSelected = selectedUserIds.filter((id) => id !== user.id);
                                  setSelectedUserIds(newSelected);
                                  const selected = slackUsers.filter((u) => newSelected.includes(u.id));
                                  const mentionText = selected.length > 0 
                                    ? selected.map((u) => `@${u.displayName || u.name}`).join(', ')
                                    : '';
                                  setShareForm((prev) => ({
                                    ...prev,
                                    receiver: mentionText
                                  }));
                                }
                              }}
                              className="w-4 h-4 text-blue-600 bg-slate-100 dark:bg-slate-700 border-slate-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-slate-800 focus:ring-2 dark:bg-slate-700 dark:border-slate-600"
                            />
                            <span>{user.displayName || user.name}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t("issueDetail.shareModal.mentionHint")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 날짜 / 시간 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t("issueDetail.shareModal.dateLabel")}
                    </label>
                    <LocalizedDateInput
                      type="date"
                      value={shareForm.date}
                      onChange={(e) => setShareForm({ ...shareForm, date: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t("issueDetail.shareModal.timeLabel")}
                    </label>
                    <input
                      type="time"
                      value={shareForm.time}
                      onChange={(e) => setShareForm({ ...shareForm, time: e.target.value })}
                      className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* 제목 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t("issueDetail.shareModal.fieldTitleLabel")}
                  </label>
                  <input
                    type="text"
                    value={shareForm.title}
                    onChange={(e) => setShareForm({ ...shareForm, title: e.target.value })}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    placeholder={t("issueDetail.shareModal.titlePlaceholder")}
                  />
                </div>

                {/* 내용 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t("issueDetail.shareModal.fieldContentLabel")}
                  </label>
                  <textarea
                    value={shareForm.content}
                    onChange={(e) => setShareForm({ ...shareForm, content: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    placeholder={t("issueDetail.shareModal.contentPlaceholder")}
                  />
                </div>

                {/* 관련 URL */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t("issueDetail.shareModal.relatedUrlLabel")}
                  </label>
                  <input
                    type="url"
                    value={shareForm.relatedUrl}
                    onChange={(e) => setShareForm({ ...shareForm, relatedUrl: e.target.value })}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    placeholder={t("issueDetail.shareModal.relatedUrlPlaceholder")}
                  />
                </div>

                {/* 유저정보 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t("issueDetail.shareModal.userInfoLabel")}
                  </label>
                  <input
                    type="text"
                    value={shareForm.userInfo}
                    onChange={(e) => setShareForm({ ...shareForm, userInfo: e.target.value })}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    placeholder={t("issueDetail.shareModal.userInfoPlaceholder")}
                  />
                </div>

                {/* 내부 테스트 결과 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t("issueDetail.shareModal.testResultLabel")}
                  </label>
                  <textarea
                    value={shareForm.testResult}
                    onChange={(e) => setShareForm({ ...shareForm, testResult: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500"
                    placeholder={t("issueDetail.shareModal.testResultPlaceholder")}
                  />
                </div>

                {/* 캡처 이미지 첨부 여부 */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t("issueDetail.shareModal.captureImageLabel")}
                    </label>
                    {(pastedImagePreview || displayPostImagePaths.length > 0) && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={excludeImage}
                          onChange={(e) => setExcludeImage(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.shareModal.excludeImage")}</span>
                      </label>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-2">
                    {(pastedImagePreview || displayPostImagePaths.length > 0) && !excludeImage ? (
                      <>
                        <span className="text-green-600 dark:text-green-400">✓</span>
                        <span className="text-slate-600 dark:text-slate-400">{t("issueDetail.shareModal.attachCapture")}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-400 dark:text-slate-500">○</span>
                        <span className="text-slate-400 dark:text-slate-500">
                          {excludeImage ? t("issueDetail.shareModal.excludeImageHint") : t("issueDetail.shareModal.noCaptureHint")}
                        </span>
                      </>
                    )}
                  </div>
                  
                  {/* 클립보드 이미지 붙여넣기 영역 */}
                  <div
                    className="mt-2 p-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                    onPaste={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const items = e.clipboardData.items;
                      
                      for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        if (item.type.indexOf('image') !== -1) {
                          const file = item.getAsFile();
                          if (file && ticket.issueId) {
                            // 미리보기 생성
                            const reader = new FileReader();
                            reader.onload = (e) => {
                              setPastedImagePreview(e.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                            
                            // 서버에 업로드
                            setUploadingImage(true);
                            try {
                              const formData = new FormData();
                              formData.append('image', file);
                              
                              const res = await fetch(`/api/issues/${ticket.issueId}/upload-image`, {
                                method: 'POST',
                                headers: authHeaders,
                                body: formData
                              });
                              
                              if (res.ok) {
                                const data = await res.json();
                                // 로컬 상태 업데이트 (페이지 새로고침 없이)
                                if (data.data?.screenshotPath) {
                                  setLocalScreenshotPath(data.data.screenshotPath);
                                  // localScreenshotPath가 설정되면 pastedImagePreview는 자동으로 무시됨 (UI에서 localScreenshotPath 우선 표시)
                                  // pastedImagePreview는 유지하여 사용자가 확인할 수 있도록 함
                                }
                                alert(t("issueDetail.alerts.imageUploaded"));
                              } else {
                                const error = await res.json();
                                alert(error.error || t("issueDetail.shareModal.imageUploadErrorFallback"));
                                setPastedImagePreview(null);
                              }
                            } catch (error) {
                              logger.error('Failed to upload image', { error });
                              alert(t("issueDetail.alerts.imageUploadFailed"));
                              setPastedImagePreview(null);
                            } finally {
                              setUploadingImage(false);
                            }
                            break;
                          }
                        }
                      }
                    }}
                  >
                    {(pastedImagePreview || displayPostImagePaths.length > 0) ? (
                      <div className="space-y-2">
                        {pastedImagePreview ? (
                          <img 
                            src={pastedImagePreview} 
                            alt={t("issueDetail.shareModal.pastedAlt")} 
                            className="max-w-full max-h-48 rounded-lg border border-slate-200 dark:border-slate-700"
                          />
                        ) : (
                          <div className="max-h-52 overflow-y-auto space-y-2">
                            {displayPostImagePaths.map((p) => (
                              <ScreenshotImage key={p} screenshotPath={p} />
                            ))}
                          </div>
                        )}
                        {uploadingImage && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">{t("issueDetail.shareModal.uploading")}</p>
                        )}
                        {!uploadingImage && !pastedImagePreview && displayPostImagePaths.length > 0 && (
                          <p className="text-xs text-green-600 dark:text-green-400 text-center">
                            ✓ {t("issueDetail.shareModal.imageUploadedStatus")}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                          📋 {t("issueDetail.shareModal.pasteClipboardHint")}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{t("issueDetail.shareModal.pasteFocusHint")}</p>
                      </div>
                    )}
                  </div>
                  
                  {displayPostImagePaths.length === 0 && !pastedImagePreview && (ticket.link || (ticket as any).sourceUrl) && (
                    <button
                      onClick={handleCaptureScreenshot}
                      disabled={capturingScreenshot}
                      className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                    >
                      {capturingScreenshot ? t("issueDetail.image.capturing") : t("issueDetail.shareModal.captureButton")}
                    </button>
                  )}
                </div>

                {/* 캡처 클립(비디오) 업로드 */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {t("issueDetail.shareModal.videoClipLabel")}
                  </label>
                  <div className="space-y-2">
                    {videoPreview || videoPath ? (
                      <div className="space-y-2">
                        {videoPreview ? (
                          <video 
                            src={videoPreview} 
                            controls
                            className="max-w-full max-h-48 rounded-lg border border-slate-200 dark:border-slate-700"
                          />
                        ) : videoPath ? (
                          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                            <p className="text-sm text-green-600 dark:text-green-400">
                              ✓ {t("issueDetail.shareModal.videoUploaded")}
                            </p>
                          </div>
                        ) : null}
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setVideoFile(null);
                              setVideoPreview(null);
                              setVideoPath(null);
                            }}
                            className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
                          >
                            {t("issueDetail.shareModal.remove")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <input
                          type="file"
                          accept="video/*,.mp4,.mov,.avi,.webm"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setVideoFile(file);
                              // 미리보기 생성
                              const reader = new FileReader();
                              reader.onload = (e) => {
                                setVideoPreview(e.target?.result as string);
                              };
                              reader.readAsDataURL(file);
                              // 업로드
                              handleVideoUpload(file);
                            }
                          }}
                          className="hidden"
                          id="video-upload-input"
                        />
                        <label
                          htmlFor="video-upload-input"
                          className="block p-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors text-center"
                        >
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                            📹 {t("issueDetail.shareModal.videoFormatsHint")}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{t("issueDetail.shareModal.clickToSelectFile")}</p>
                        </label>
                        {uploadingVideo && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-2">{t("issueDetail.shareModal.uploading")}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 슬랙 채널 선택 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t("issueDetail.shareModal.slackChannel")}
                </label>
                {loadingChannels ? (
                  <div className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    {t("issueDetail.shareModal.channelsLoading")}
                  </div>
                ) : slackChannels.length > 0 ? (
                  <select
                    value={selectedChannel}
                    onChange={(e) => setSelectedChannel(e.target.value)}
                    className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    {slackChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.isPrivate ? '🔒 ' : '#'} {channel.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full px-3 py-2 border dark:border-slate-700 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400">
                    <p className="font-medium mb-1">⚠️ {t("issueDetail.shareModal.noBotChannelsTitle")}</p>
                    <p className="text-sm">
                      {t("issueDetail.shareModal.noBotChannelsBody")}
                      <br />
                      <span className="text-sm">({t("issueDetail.shareModal.noBotChannelsInvite")})</span>
                    </p>
                  </div>
                )}
              </div>

              {/* 버튼 */}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowShareModal(false);
                    setShareMessage('');
                    setSelectedChannel('');
                  }}
                  className="px-4 py-2 border dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {t("issueDetail.shareModal.cancel")}
                </button>
                <button
                  onClick={handleShareToSlack}
                  disabled={sharing}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sharing ? t("issueDetail.shareModal.sending") : t("issueDetail.shareModal.send")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 모바일 최적화: React.memo로 불필요한 리렌더링 방지
export default memo(IssueDetailPanel, (prevProps, nextProps) => {
  // ticket의 issueId가 같으면 리렌더링 방지 (다른 필드는 내부에서 처리)
  if (prevProps.ticket.issueId !== nextProps.ticket.issueId) {
    return false; // 리렌더링 필요
  }
  
  // 다른 props가 변경되었는지 확인
  if (prevProps.agents !== nextProps.agents) return false;
  if (prevProps.comments !== nextProps.comments) return false;
  if (prevProps.commentsLoading !== nextProps.commentsLoading) return false;
  if (prevProps.newComment !== nextProps.newComment) return false;
  if (prevProps.submittingComment !== nextProps.submittingComment) return false;
  if (prevProps.onClose !== nextProps.onClose) return false;
  if (prevProps.onStatusChange !== nextProps.onStatusChange) return false;
  if (prevProps.onAssignAgent !== nextProps.onAssignAgent) return false;
  if (prevProps.onCommentChange !== nextProps.onCommentChange) return false;
  if (prevProps.onSubmitComment !== nextProps.onSubmitComment) return false;
  
  // ticket의 다른 필드는 내부 useEffect에서 처리하므로 무시
  return true; // 리렌더링 불필요
});
