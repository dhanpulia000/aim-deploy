import React from "react";
import { useTranslation } from "react-i18next";
import { TicketCard } from "./TicketCard";
import { useTicketInteractions } from "../hooks/useTicketInteractions";
import { sanitizeTitle, getAssigneeName } from "../utils/ticketUtils";
import { fmt } from "../utils/formatters";
import type { Ticket, Agent } from "../types";

interface TicketCardItemProps {
  ticket: Ticket;
  projectAgents: Agent[];
  agents: Agent[];
  token: string | null;
  selectedTicketIds: Set<string>;
  getCurrentAgentId: () => string | null;
  handleSelectTicket: (ticket: Ticket) => void;
  toggleTicketSelection: (ticketId: string) => void;
  setTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  setSelectedTicketIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  withProjectParam: (path: string) => string;
  authHeadersOrUndefined?: HeadersInit;
}

/**
 * 티켓 카드 아이템 컴포넌트 (훅 사용 가능)
 */
export function TicketCardItem({
  ticket,
  projectAgents,
  agents,
  token,
  selectedTicketIds,
  getCurrentAgentId,
  handleSelectTicket,
  toggleTicketSelection,
  setTickets,
  setSelectedTicketIds,
  withProjectParam,
  authHeadersOrUndefined
}: TicketCardItemProps) {
  const { t } = useTranslation("app");
  const interactions = useTicketInteractions({
    ticket,
    currentAgentId: getCurrentAgentId(),
    token,
    selectedTicketIds,
    onSelectTicket: handleSelectTicket,
    onToggleSelection: toggleTicketSelection,
    onTicketsUpdate: setTickets,
    onSelectedIdsUpdate: setSelectedTicketIds,
    withProjectParam,
    authHeadersOrUndefined
  });
  
  const assigneeName = getAssigneeName(ticket, projectAgents, agents);
  const otherCat = t("ticketFallback.other");
  const categoryLabel =
    ticket.primaryCategory && ticket.primaryCategory !== "기타" && ticket.primaryCategory !== otherCat
      ? ticket.primaryCategory
      : null;
  const isSelected = selectedTicketIds.has(ticket.id);
  const displayTitle = sanitizeTitle(ticket.title);

  return (
    <TicketCard
      ticket={{ ...ticket, title: displayTitle }}
      isSelected={isSelected}
      isChecked={interactions.isChecked}
      isProcessed={interactions.isProcessed}
      isIssue={interactions.isIssue}
      currentAgentId={interactions.currentAgentId}
      assigneeName={assigneeName}
      categoryLabel={categoryLabel}
      onRowClick={interactions.handleRowClick}
      onLinkClick={interactions.handleLinkClick}
      onCheckClick={interactions.handleCheckClick}
      onProcessClick={interactions.handleProcessClick}
      onExcludeFromReportClick={interactions.handleExcludeFromReportClick}
      onToggleSelection={toggleTicketSelection}
      formatTime={fmt.time}
    />
  );
}
