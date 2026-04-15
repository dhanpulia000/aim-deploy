// WebSocket 실시간 이벤트 타입 정의

import type { Agent, Ticket } from './index';

export type RealtimeEvent =
  | {
      type: 'agent_status_update';
      payload: {
        projectId: number | null;
        agentId: string;
        status: string;
        handling?: number;
        todayResolved?: number;
        avgHandleSec?: number;
      };
    }
  | {
      type: 'issue_created';
      payload: {
        projectId: number | null;
        issueId: string;
        title?: string;
        severity?: number;
        category?: string;
        status: string;
        source?: string;
        createdAt: string;
      };
    }
  | {
      type: 'issue_updated';
      payload: {
        projectId: number | null;
        issueId: string;
        /** 백엔드 broadcastIssueUpdated와 동일 — 제목·분류만 갱신된 경우에도 UI 반영 */
        title?: string;
        category?: string | null;
        source?: string;
        status?: string;
        assignedAgentId?: string | null;
        assignedAgentName?: string | null;
        severity?: number;
        checkedAt?: string | null;
        processedAt?: string | null;
      };
    }
  | {
      type: 'issue_comments_updated';
      payload: {
        projectId: number | null;
        issueId: string;
        commentCount?: number;
      };
    }
  | {
      type: 'sla_violation';
      payload: {
        projectId: number;
        issueIds: string[];
        severity: string;
        policyId: number;
        responseSec: number;
      };
    }
  | {
      type: 'initial_state';
      payload: {
        agents: Agent[];
        tickets: Ticket[];
      };
    }
  | {
      type: 'state_update';
      payload: {
        agents: Agent[];
        tickets: Ticket[];
        timestamp: number;
      };
    };

export type RealtimeEventType = RealtimeEvent['type'];

export interface RealtimeEventHandlers {
  onAgentStatusUpdate?: (payload: Extract<RealtimeEvent, { type: 'agent_status_update' }>['payload']) => void;
  onIssueCreated?: (payload: Extract<RealtimeEvent, { type: 'issue_created' }>['payload']) => void;
  onIssueUpdated?: (payload: Extract<RealtimeEvent, { type: 'issue_updated' }>['payload']) => void;
  onIssueCommentsUpdated?: (payload: Extract<RealtimeEvent, { type: 'issue_comments_updated' }>['payload']) => void;
  onSlaViolation?: (payload: Extract<RealtimeEvent, { type: 'sla_violation' }>['payload']) => void;
  onInitialState?: (payload: Extract<RealtimeEvent, { type: 'initial_state' }>['payload']) => void;
  onStateUpdate?: (payload: Extract<RealtimeEvent, { type: 'state_update' }>['payload']) => void;
  // 레거시 호환 (deprecated)
  onInitial?: (payload: Extract<RealtimeEvent, { type: 'initial_state' }>['payload']) => void;
  onUpdate?: (payload: Extract<RealtimeEvent, { type: 'state_update' }>['payload']) => void;
}

