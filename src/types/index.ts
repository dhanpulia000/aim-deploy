// Shared Types

// ============================================================================
// Enums & Union Types
// ============================================================================

export type AgentStatus = "available" | "busy" | "away" | "offline";

export type IssueStatus = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "VERIFIED" | "CLOSED";

export type IssueSeverity = 1 | 2 | 3; // 1=Sev1(심각), 2=중, 3=경미

export type IssueImportance = "HIGH" | "MEDIUM" | "LOW";

export type IssueSentiment = "neg" | "neu" | "pos";

export type IssueSource = "discord" | "naver" | "system";

export type UserRole = "AGENT" | "LEAD" | "ADMIN";

export type ShareStatus = "SUCCESS" | "FAILED";

export type AIClassificationMethod = "AI" | "RULE" | null;

// ============================================================================
// API Response Types
// ============================================================================

/**
 * 표준 API 응답 형식 (백엔드 sendSuccess/sendError와 일치)
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string | null;
  timestamp?: string;
}

/**
 * 페이지네이션된 응답
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// Core Entity Types (Prisma Schema 기반)
// ============================================================================

/**
 * Agent (에이전트) - Prisma Agent 모델 기반
 */
export interface AgentSchedule {
  id?: number;
  agentId: string;
  scheduleType: 'weekly' | 'specific';
  dayOfWeek?: number | null; // 0=일요일, 1=월요일, ..., 6=토요일 (weekly일 때만)
  specificDate?: string | null; // YYYY-MM-DD 형식 (specific일 때만)
  startTime: string; // HH:mm 형식
  endTime: string; // HH:mm 형식
  isActive: boolean;
}

export interface Agent {
  id: string;
  name: string;
  avatar?: string | null;
  status: AgentStatus;
  handling: number; // 현재 처리중 티켓 수
  todayResolved: number;
  avgHandleSec: number; // 평균 처리 시간(초)
  channelFocus: string[]; // 담당 게임 목록 (JSON 배열)
  schedules?: AgentSchedule[]; // 에이전트 스케줄 목록
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  slackId?: string | null;
  isActive: boolean;
  projectId?: number | null;
  userId?: number | null;
  createdAt?: string; // ISO date string
  updatedAt?: string; // ISO date string
}

// ============================================================================
// Legacy Types (하위 호환성 유지)
// ============================================================================

export type TicketSeverity = IssueSeverity; // 1=Sev1(심각), 2=중, 3=경미

export type IssueWorkflowStatus = IssueStatus;

/**
 * Ticket (이슈) - Prisma ReportItemIssue 모델 기반
 */
export interface Ticket {
  id: string;
  issueId?: string;
  title: string;
  source: IssueSource;
  createdAt: number; // epoch ms
  slaDeadlineAt?: number; // epoch ms
  severity: IssueSeverity;
  sentiment: IssueSentiment;
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  assigneeId?: string | null;
  status: IssueStatus;
  link?: string | null; // 원문 링크
  tags?: string[];
  categories?: string[];
  primaryCategory?: string | null;
  commentsCount?: number;
  scrapedComments?: string | null; // 수집된 댓글 JSON 문자열
  isHotTopic?: boolean; // 핫토픽 여부 (댓글이 많거나 중요 인물의 글)
  checkedAt?: number | null;
  checkedBy?: string | null;
  processedAt?: number | null;
  processedBy?: string | null;
  // 보고서 제외 상태
  excludedFromReport?: boolean; // 일일 보고서 및 모니터링 대응에서 제외 여부
  excludedAt?: number | null; // 보고서 제외 처리 시각
  excludedBy?: string | null; // 보고서 제외 처리한 에이전트 ID
  // 원본 게시글 작성 시간
  sourceCreatedAt?: number | null; // 원본 게시글의 작성 시간 (네이버 카페, 슬랙 등에서 추출)
  // AI 분류 정보
  aiClassificationReason?: string | null; // AI 분류 이유
  aiClassificationMethod?: AIClassificationMethod; // 분류 방법
  trend?: string | null; // 동향/토픽 요약
  // 카테고리 정보 (검수용)
  categoryGroupId?: number | null;
  categoryId?: number | null;
  categoryGroupName?: string | null;
  categoryName?: string | null;
  // 원문 내용 (검수용)
  detail?: string | null; // 원문 본문
  summary?: string | null; // 원문 제목/요약
  // 게임명
  gameName?: string | null; // 표시용 라벨 (CRAWLER_GAME.label 등)
  /** MonitoredBoard.cafeGame / 역매핑된 코드 — 게임 필터·집계 키 */
  cafeGameCode?: string | null;
  // 스크린샷
  screenshotPath?: string | null; // 스크린샷 파일 경로
  /** 게시글 본문 이미지 경로 배열(API는 JSON 문자열로 올 수 있음) */
  postImagePaths?: string[] | string | null;
  /** Discourse(inZOI Forums) 지표 — 있으면 목록 컬럼에서 우선 표시 */
  discourseViews?: number | null;
  discourseLikeCount?: number | null;
  discourseReplyCount?: number | null;
  hasImages?: boolean; // 게시글에 이미지가 있는지 여부
  requiresLogin?: boolean; // 계정이 있어야만 확인할 수 있는 게시글인지 여부
  hasKeywordMatch?: boolean; // 키워드가 매칭된 게시글인지 여부
  // 추가 필드
  importance?: IssueImportance; // HIGH, MEDIUM, LOW
  projectId?: number | null;
  channelId?: number | null;
  date?: string; // YYYY-MM-DD 형식
  externalPostId?: string | null;
  externalSource?: string | null;
  slackMessageTs?: string | null;
  slackChannelId?: string | null;
  slaBreachedAt?: number | null; // epoch ms
}

/**
 * Project (프로젝트) - Prisma Project 모델 기반
 */
export interface Project {
  id: number;
  name: string;
  description?: string | null;
  createdAt?: string; // ISO date string
  updatedAt?: string; // ISO date string
}

/**
 * CategoryGroup (대분류) - Prisma CategoryGroup 모델 기반
 */
export interface CategoryGroup {
  id: number;
  name: string;
  code: string;
  color?: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt?: string; // ISO date string
  updatedAt?: string; // ISO date string
}

/**
 * Category (중분류) - Prisma Category 모델 기반
 */
export interface Category {
  id: number;
  groupId: number;
  name: string;
  code?: string | null;
  importance: IssueImportance;
  description?: string | null;
  isActive: boolean;
  createdAt?: string; // ISO date string
  updatedAt?: string; // ISO date string
  group?: CategoryGroup; // 관계 데이터
}

/**
 * IssueComment (이슈 댓글) - Prisma IssueComment 모델 기반
 */
export interface IssueComment {
  id: number;
  issueId: string;
  body: string;
  createdAt: string; // ISO date string
  authorId?: string | null;
  authorName?: string | null;
  externalCommentId?: string | null; // Naver Cafe comment ID 등
}

/**
 * IssueShareLog (이슈 공유 로그) - Prisma IssueShareLog 모델 기반
 */
export interface IssueShareLog {
  id: number;
  issueId: string;
  agentId?: string | null;
  agentName?: string | null;
  target: string; // 'Client_Channel', 'Internal_Channel' 등
  sentAt: string; // ISO date string
  status: ShareStatus;
  messageSnapshot?: string | null;
  errorMessage?: string | null;
  createdAt: string; // ISO date string
  updatedAt?: string; // ISO date string
}

/**
 * AuditLog (감사 로그) - Prisma AuditLog 모델 기반
 */
export interface AuditLog {
  id: number;
  userId?: number | null;
  action: string; // 'LOGIN', 'ISSUE_STATUS_CHANGE', 'SLA_VIOLATION' 등
  meta?: string | null; // JSON 문자열
  createdAt: string; // ISO date string
}

export interface CustomerFeedbackNotice {
  id: number;
  title?: string | null; // 공지 제목
  gameName: string;
  managerName: string;
  category: string;
  content: string;
  noticeDate: string; // ISO date string
  endedAt?: string | null; // 종료 처리 시각 (ISO)
  url?: string | null; // 링크 URL (공지글에서 이동용)
  screenshotPath?: string | null; // 스크린샷 이미지 경로
  slackChannelId?: string | null; // 슬랙 채널 ID (채널 링크 생성용)
  slackTeamId?: string | null; // 슬랙 팀 ID (채널 링크 생성용)
  createdBy?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  readAgents?: Array<{
    id: string;
    name: string;
    readAt: string;
  }>;
  unreadAgents?: Array<{
    id: string;
    name: string;
  }>;
}

