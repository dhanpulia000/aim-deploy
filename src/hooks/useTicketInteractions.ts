import { useCallback, type MouseEvent } from "react";
import { logger } from "../utils/logger";
import type { Ticket } from "../types";

interface UseTicketInteractionsProps {
  ticket: Ticket;
  currentAgentId: string | null;
  token: string | null;
  selectedTicketIds: Set<string>;
  onSelectTicket: (ticket: Ticket) => void;
  onToggleSelection: (ticketId: string) => void;
  onTicketsUpdate: (updater: (prev: Ticket[]) => Ticket[]) => void;
  onSelectedIdsUpdate: (updater: (prev: Set<string>) => Set<string>) => void;
  withProjectParam: (path: string) => string;
  authHeadersOrUndefined?: HeadersInit;
}

/**
 * 티켓 상호작용 핸들러를 제공하는 커스텀 훅
 */
export function useTicketInteractions({
  ticket,
  currentAgentId,
  token,
  selectedTicketIds,
  onSelectTicket,
  onToggleSelection,
  onTicketsUpdate,
  onSelectedIdsUpdate,
  withProjectParam,
  authHeadersOrUndefined: _authHeadersOrUndefined
}: UseTicketInteractionsProps) {
  // 이슈 판별: id가 issue_로 시작하거나 issueId가 있는 경우
  const isIssue = ticket.id.startsWith("issue_") || !!ticket.issueId;
  const isChecked = !!ticket.checkedAt;
  // 완료된 이슈 판별: processedAt이 있거나, excludedFromReport가 true이거나, status가 완료 상태인 경우
  const isProcessed = !!ticket.processedAt || !!ticket.excludedFromReport || 
    ticket.status === 'RESOLVED' || ticket.status === 'VERIFIED' || ticket.status === 'CLOSED';

  const handleRowClick = useCallback(() => {
    logger.debug('handleRowClick called', { ticketId: ticket.id, selectedCount: selectedTicketIds.size });
    if (selectedTicketIds.size > 0) {
      onToggleSelection(ticket.id);
      return;
    }
    onSelectTicket(ticket);
  }, [ticket, selectedTicketIds.size, onSelectTicket, onToggleSelection]);

  const openLink = useCallback(() => {
    if (ticket.link) {
      window.open(ticket.link, "_blank");
    }
  }, [ticket.link]);

  const handleLinkClick = useCallback(async (e?: MouseEvent<Element>) => {
    e?.stopPropagation();
    if (!ticket.link) return;

    if (!isIssue || !currentAgentId || isChecked) {
      openLink();
      return;
    }

    e?.preventDefault();
    try {
      const issueId = ticket.issueId || ticket.id.replace("issue_", "");
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
      const res = await fetch(withProjectParam(`/api/issues/${issueId}/check`), {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId: currentAgentId })
      });

      if (res.ok) {
        const timestamp = Date.now();
        onTicketsUpdate(prev => prev.map(t =>
          t.id === ticket.id
            ? { ...t, checkedAt: timestamp, checkedBy: currentAgentId }
            : t
        ));
      }
    } catch (error) {
      logger.error("Failed to check issue", { error });
    } finally {
      openLink();
    }
  }, [ticket, isIssue, currentAgentId, isChecked, openLink, token, withProjectParam, onTicketsUpdate]);

  const handleCheckClick = useCallback(async (e: MouseEvent<Element>) => {
    e.stopPropagation();
    if (!isIssue || !currentAgentId || isChecked) return;

    try {
      const issueId = ticket.issueId || ticket.id.replace("issue_", "");
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
      const res = await fetch(withProjectParam(`/api/issues/${issueId}/check`), {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId: currentAgentId })
      });

      if (res.ok) {
        const timestamp = Date.now();
        onTicketsUpdate(prev => prev.map(t =>
          t.id === ticket.id
            ? { ...t, checkedAt: timestamp, checkedBy: currentAgentId }
            : t
        ));
      }
    } catch (error) {
      logger.error("Failed to check issue", { error });
    }
  }, [ticket, isIssue, currentAgentId, isChecked, token, withProjectParam, onTicketsUpdate]);

  const handleProcessClick = useCallback(async (e: MouseEvent<Element>) => {
    e.stopPropagation();
    if (!isIssue || !currentAgentId) return;

    if (!confirm("이슈 처리를 완료하시겠습니까?")) return;

    try {
      const issueId = ticket.issueId || ticket.id.replace("issue_", "");
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
      const res = await fetch(withProjectParam(`/api/issues/${issueId}/process`), {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId: currentAgentId })
      });

      if (res.ok) {
        const timestamp = Date.now();
        onTicketsUpdate(prev => prev.map(t =>
          t.id === ticket.id
            ? { ...t, processedAt: timestamp, processedBy: currentAgentId, status: "RESOLVED" }
            : t
        ));
        // 체크박스 자동 해제
        onSelectedIdsUpdate(prev => {
          const next = new Set(prev);
          next.delete(ticket.id);
          return next;
        });
      }
    } catch (error) {
      logger.error("Failed to process issue", { error });
    }
  }, [ticket, isIssue, currentAgentId, token, withProjectParam, onTicketsUpdate, onSelectedIdsUpdate]);

  const handleExcludeFromReportClick = useCallback(async (e: MouseEvent<Element>) => {
    e.stopPropagation();
    if (!isIssue || !currentAgentId) return;

    if (!confirm("이 항목을 보고서에서 제외하고 완료 처리하시겠습니까?\n(일일 보고서 및 모니터링 대응에서 제외됩니다)")) return;

    try {
      const issueId = ticket.issueId || ticket.id.replace("issue_", "");
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
      const res = await fetch(withProjectParam(`/api/issues/${issueId}/exclude-from-report`), {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId: currentAgentId })
      });

      if (res.ok) {
        const timestamp = Date.now();
        onTicketsUpdate(prev => prev.map(t =>
          t.id === ticket.id
            ? { 
                ...t, 
                excludedFromReport: true,
                excludedAt: timestamp,
                excludedBy: currentAgentId,
                processedAt: timestamp, 
                processedBy: currentAgentId, 
                status: "RESOLVED" 
              }
            : t
        ));
        // 체크박스 자동 해제
        onSelectedIdsUpdate(prev => {
          const next = new Set(prev);
          next.delete(ticket.id);
          return next;
        });
      }
    } catch (error) {
      logger.error("Failed to exclude issue from report", { error });
      alert("보고서 제외 처리에 실패했습니다.");
    }
  }, [ticket, isIssue, currentAgentId, token, withProjectParam, onTicketsUpdate, onSelectedIdsUpdate]);

  return {
    currentAgentId,
    isIssue,
    isChecked,
    isProcessed,
    handleRowClick,
    handleLinkClick,
    handleCheckClick,
    handleProcessClick,
    handleExcludeFromReportClick
  };
}
