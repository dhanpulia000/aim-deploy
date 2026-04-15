import React, { memo } from "react";
import type { Ticket } from "../types";
import { classNames, statusLabelMap, statusPillClass, gameBadgeClass, gameAccentClass, listRowBackgroundClass } from "../utils/ticketUtils";

interface TicketListRowProps {
  ticket: Ticket;
  isSelected: boolean;
  isChecked: boolean;
  isProcessed: boolean;
  isIssue: boolean;
  currentAgentId: string | null;
  assigneeName: string | null;
  onRowClick: () => void;
  onLinkClick: (e: React.MouseEvent) => void;
  onCheckClick: (e: React.MouseEvent) => void;
  onProcessClick: (e: React.MouseEvent) => void;
  onExcludeFromReportClick?: (e: React.MouseEvent) => void;
  onToggleSelection: (ticketId: string) => void;
  formatTime: (ms: number) => string;
}

export const TicketListRow = memo<TicketListRowProps>(({
  ticket,
  isSelected,
  isChecked,
  isProcessed,
  isIssue,
  currentAgentId,
  assigneeName,
  onRowClick,
  onLinkClick,
  onCheckClick,
  onProcessClick,
  onExcludeFromReportClick,
  onToggleSelection,
  formatTime
}) => {
  const statusLabel = statusLabelMap[ticket.status] || "미열람";
  const rowBgClass = listRowBackgroundClass(isProcessed, isChecked);
  const accentClass = gameAccentClass(ticket.gameName);

  return (
    <div
      className={classNames(
        "grid items-center gap-3 py-2 text-sm border-b last:border-b-0 cursor-pointer transition-colors",
        "grid-cols-[150px,150px,1fr,220px,120px]",
        accentClass,
        rowBgClass,
        isSelected ? "ring-2 ring-blue-300" : "hover:bg-slate-50"
      )}
      onClick={onRowClick}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 flex-wrap">
          {isIssue && (
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelection(ticket.id)}
              className="cursor-pointer"
              title="이슈 선택"
            />
          )}
          <span className={classNames("px-2 py-0.5 rounded-full text-[11px] font-semibold", statusPillClass(ticket.status))}>
            {statusLabel}
          </span>
        </div>
        <div className="flex gap-1 text-[11px] flex-wrap items-center">
          <span className={classNames("px-2 py-0.5 rounded-full font-semibold", gameBadgeClass(ticket.gameName))}>
            {ticket.gameName || "기타"}
          </span>
          {ticket.requiresLogin && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] flex-shrink-0" title="계정이 있어야만 확인할 수 있는 게시글">
              🔒 로그인 필요
            </span>
          )}
          {ticket.commentsCount && ticket.commentsCount > 0 && (() => {
            const isHot = ticket.isHotTopic || (ticket.commentsCount && ticket.commentsCount >= 10);
            const commentTooltip = (() => {
              if (!ticket.scrapedComments) return `댓글 ${ticket.commentsCount}개`;
              try {
                const comments = JSON.parse(ticket.scrapedComments);
                if (Array.isArray(comments) && comments.length > 0) {
                  const preview = comments.slice(0, 3).map((c: any, idx: number) => 
                    `${idx + 1}. ${c.author || '익명'}: ${(c.text || c.content || '').substring(0, 30)}${(c.text || c.content || '').length > 30 ? '...' : ''}`
                  ).join('\n');
                  return `댓글 ${ticket.commentsCount}개\n\n[주요 댓글]\n${preview}`;
                }
              } catch (e) {
                // JSON 파싱 실패 시 기본 툴팁
              }
              return `댓글 ${ticket.commentsCount}개`;
            })();
            
            return (
              <span 
                className={classNames(
                  "px-2 py-0.5 rounded-full text-[10px] flex-shrink-0 font-semibold",
                  isHot 
                    ? "bg-red-100 text-red-700 border border-red-300" 
                    : "bg-purple-100 text-purple-700"
                )}
                title={commentTooltip}
              >
                {isHot ? '🔥' : '💬'} {ticket.commentsCount}
              </span>
            );
          })()}
          {!isSelected && !isChecked && isIssue && currentAgentId && (
            <button
              onClick={onCheckClick}
              className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 hover:bg-slate-300"
            >
              열람
            </button>
          )}
          {(isChecked || isSelected) && !isProcessed && isIssue && currentAgentId && (
            <>
              <button
                onClick={onProcessClick}
                className="px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                처리
              </button>
              {onExcludeFromReportClick && (
                <button
                  onClick={onExcludeFromReportClick}
                  className="px-2 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-700"
                  title="보고서에서 제외하고 완료 처리"
                >
                  보고서 제외
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div 
        className="text-xs text-slate-500" 
        title={ticket.sourceCreatedAt && ticket.createdAt 
          ? `수집 시간: ${formatTime(ticket.createdAt)}\n원본 작성: ${formatTime(ticket.sourceCreatedAt)}`
          : ticket.sourceCreatedAt 
            ? `수집 시간: ${formatTime(ticket.createdAt)}\n원본 작성: ${formatTime(ticket.sourceCreatedAt)}`
            : `수집 시간: ${formatTime(ticket.createdAt)}`}
      >
        {formatTime(ticket.createdAt)}
      </div>
      <div className="text-xs text-blue-600 truncate" title={ticket.primaryCategory || "기타"}>
        {ticket.primaryCategory || "기타"}
      </div>
      <div className="truncate font-medium" title={ticket.title}>
        {ticket.link ? (
          <a
            className={classNames("hover:underline", isChecked ? "text-slate-500 line-through" : "text-slate-800")}
            href={ticket.link}
            target="_blank"
            rel="noreferrer"
            onClick={onLinkClick}
          >
            {ticket.title}
          </a>
        ) : (
          <span className={isChecked ? "text-slate-500 line-through" : undefined}>{ticket.title}</span>
        )}
      </div>
      <div className="text-xs text-slate-600 truncate" title={assigneeName || "미배정"}>
        {assigneeName || "—"}
      </div>
    </div>
  );
});

TicketListRow.displayName = "TicketListRow";

