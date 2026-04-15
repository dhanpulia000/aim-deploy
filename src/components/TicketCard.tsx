import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import type { Ticket } from "../types";
import { Countdown } from "./Countdown";
import { ProcessedTime } from "./ProcessedTime";
import { SourceBadge } from "./SourceBadge";
import { classNames, sevColor, getRowBgColor, gameBadgeClass } from "../utils/ticketUtils";

interface TicketCardProps {
  ticket: Ticket;
  isSelected: boolean;
  isChecked: boolean;
  isProcessed: boolean;
  isIssue: boolean;
  currentAgentId: string | null;
  assigneeName: string | null;
  categoryLabel: string | null;
  onRowClick: () => void;
  onLinkClick: (e: React.MouseEvent) => void;
  onCheckClick: (e: React.MouseEvent) => void;
  onProcessClick: (e: React.MouseEvent) => void;
  onExcludeFromReportClick?: (e: React.MouseEvent) => void;
  onToggleSelection: (ticketId: string) => void;
  formatTime: (ms: number) => string;
}

function statusLabel(ta: (k: string) => string, status?: string) {
  let s = status || "OPEN";
  if (s === "WAITING") s = "IN_PROGRESS";
  if (s === "VERIFIED") s = "RESOLVED";
  const key = `status.${s}`;
  const v = ta(key);
  return v === key ? ta("status.OPEN") : v;
}

function parseDiscoursePreamble(detail: string | null | undefined): {
  views?: number;
  likes?: number;
  replies?: number;
  lastActivityText?: string;
  imageUrl?: string;
} {
  if (!detail) return {};
  const head = detail.split("\n").slice(0, 40).join("\n"); // preamble is at top
  if (!head.includes("Discourse (inZOI Forums)")) return {};

  const getNum = (re: RegExp) => {
    const m = head.match(re);
    if (!m) return undefined;
    const n = parseInt(m[1].replace(/,/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  };

  const views = getNum(/조회\s+([\d,]+)/);
  const likes = getNum(/좋아요\s+([\d,]+)/);
  const replies = getNum(/답글\s+([\d,]+)/);

  const lastActivityLine = head
    .split("\n")
    .find((l) => l.trim().startsWith("마지막 활동:"));
  const lastActivityText = lastActivityLine ? lastActivityLine.replace("마지막 활동:", "").trim() : undefined;

  const imageLine = head.split("\n").find((l) => l.trim().startsWith("대표 이미지:"));
  const imageUrl = imageLine ? imageLine.replace("대표 이미지:", "").trim() : undefined;

  return { views, likes, replies, lastActivityText, imageUrl };
}

export const TicketCard = memo<TicketCardProps>(
  ({
    ticket,
    isSelected,
    isChecked,
    isProcessed,
    isIssue,
    currentAgentId,
    assigneeName,
    categoryLabel,
    onRowClick,
    onLinkClick,
    onCheckClick,
    onProcessClick,
    onExcludeFromReportClick,
    onToggleSelection,
    formatTime,
  }) => {
    const { t } = useTranslation("components");
    const { t: ta } = useTranslation("app");

    const timeTitle =
      ticket.sourceCreatedAt && ticket.createdAt
        ? `${t("ticketCard.timeIngested")}: ${formatTime(ticket.createdAt)}\n${t("ticketCard.timeSource")}: ${formatTime(ticket.sourceCreatedAt)}`
        : ticket.sourceCreatedAt
          ? `${t("ticketCard.timeIngested")}: ${formatTime(ticket.createdAt)}\n${t("ticketCard.timeSource")}: ${formatTime(ticket.sourceCreatedAt)}`
          : `${t("ticketCard.timeIngested")}: ${formatTime(ticket.createdAt)}`;

    const commentTooltip =
      ticket.commentsCount && ticket.commentsCount > 0
        ? (() => {
            if (!ticket.scrapedComments) return t("ticketCard.comments", { count: ticket.commentsCount });
            try {
              const comments = JSON.parse(ticket.scrapedComments);
              if (Array.isArray(comments) && comments.length > 0) {
                const preview = comments
                  .slice(0, 3)
                  .map(
                    (c: { author?: string; text?: string; content?: string }, idx: number) =>
                      `${idx + 1}. ${c.author || t("ticketCard.anonymous")}: ${(c.text || c.content || "").substring(0, 30)}${(c.text || c.content || "").length > 30 ? "..." : ""}`
                  )
                  .join("\n");
                return t("ticketCard.commentsPreviewTitle", {
                  count: ticket.commentsCount,
                  preview,
                });
              }
            } catch {
              /* ignore */
            }
            return t("ticketCard.comments", { count: ticket.commentsCount });
          })()
        : "";

    const isDiscourseIssue =
      ticket.source === "discourse" ||
      ticket.source === "DISCOURSE_PLAYINZOI" ||
      ticket.externalSource === "DISCOURSE_PLAYINZOI";
    const discourseMeta = isDiscourseIssue ? parseDiscoursePreamble(ticket.detail) : {};

    const repliesValue =
      typeof ticket.discourseReplyCount === "number"
        ? ticket.discourseReplyCount
        : typeof discourseMeta.replies === "number"
          ? discourseMeta.replies
          : typeof ticket.commentsCount === "number"
            ? ticket.commentsCount
            : undefined;

    const likesValue =
      typeof ticket.discourseLikeCount === "number"
        ? ticket.discourseLikeCount
        : typeof discourseMeta.likes === "number"
          ? discourseMeta.likes
          : undefined;

    const viewsValue =
      typeof ticket.discourseViews === "number"
        ? ticket.discourseViews
        : typeof discourseMeta.views === "number"
          ? discourseMeta.views
          : undefined;

    return (
      <div
        className={classNames(
          // MonitoringControl(최근 로그)와 동일한 row 톤으로 통일
          "mb-2 rounded-xl border px-3 py-3 text-xs transition-colors",
          "border-slate-200 bg-white hover:bg-slate-50/60",
          "dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-800/70",
          getRowBgColor(ticket.severity, isChecked, isProcessed, ticket.gameName, ticket.trend),
          isSelected && "ring-2 ring-blue-500 ring-offset-2",
          isProcessed && "opacity-75"
        )}
        onClick={onRowClick}
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_80px_80px_90px_140px_120px] gap-3 items-start md:min-w-[1010px]">
          {/* Topic column (sticky on horizontal scroll) */}
          <div
            className={classNames(
              "min-w-0",
              isIssue ? "" : "md:col-span-6",
              "md:sticky md:left-0 md:z-10",
              "md:bg-white/95 md:backdrop-blur",
              "dark:md:bg-slate-800/95",
              "md:pr-3"
            )}
          >
            <div className="flex items-start gap-3 min-w-0">
              {isIssue && (
                <div className="flex flex-col gap-1 items-center pt-0.5 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelection(ticket.id)}
                    className="cursor-pointer w-3 h-3"
                    title={t("ticketCard.selectIssue")}
                  />
                  {!isSelected && !isChecked && currentAgentId && (
                    <button
                      onClick={onCheckClick}
                      className="text-xs sm:text-[10px] px-2 sm:px-2 py-1.5 sm:py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium shadow-sm touch-manipulation"
                    >
                      {t("ticketCard.read")}
                    </button>
                  )}
                  {(isChecked || isSelected) && !isProcessed && currentAgentId && (
                    <>
                      <button
                        onClick={onProcessClick}
                        className="text-xs sm:text-[10px] px-2 sm:px-2 py-1.5 sm:py-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all font-semibold shadow-sm touch-manipulation"
                      >
                        {t("ticketCard.process")}
                      </button>
                      {onExcludeFromReportClick && (
                        <button
                          onClick={onExcludeFromReportClick}
                          className="text-xs sm:text-[10px] px-2 sm:px-2 py-1.5 sm:py-1 bg-gradient-to-r from-orange-600 to-orange-700 text-white rounded-lg hover:from-orange-700 hover:to-orange-800 transition-all font-semibold shadow-sm touch-manipulation"
                          title={t("ticketCard.excludeReportTitle")}
                        >
                          {t("ticketCard.excludeReport")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
            {/* Title (wraps, increases row height as needed) */}
            <div className="min-w-0">
              {ticket.link ? (
                <a
                  className={classNames(
                    "block text-sm font-semibold whitespace-normal break-words leading-snug",
                    "line-clamp-2",
                    isProcessed
                      ? "line-through text-slate-400"
                      : isChecked
                        ? "line-through text-slate-500"
                        : "text-slate-900 dark:text-slate-100",
                    "hover:underline"
                  )}
                  href={ticket.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onLinkClick}
                  title={ticket.title}
                >
                  {ticket.title}
                </a>
              ) : (
                <div
                  className={classNames(
                    "text-sm font-semibold whitespace-normal break-words leading-snug",
                    "line-clamp-2",
                    isProcessed ? "line-through text-slate-400" : isChecked && "line-through text-slate-500",
                    !isProcessed && "text-slate-900 dark:text-slate-100"
                  )}
                  title={ticket.title}
                >
                  {ticket.title}
                </div>
              )}
            </div>

            {/* Meta row (kept separate from title) */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-500 flex-shrink-0" title={timeTitle}>
                {formatTime(ticket.createdAt)}
              </span>
              <span
                className={classNames(
                  "px-1.5 py-0.5 text-[10px] rounded-full border flex-shrink-0",
                  sevColor(ticket.severity)
                )}
              >
                Sev{ticket.severity}
              </span>
              <SourceBadge src={ticket.source} />
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {ticket.gameName && (
                <span className={`px-2 py-1 ${gameBadgeClass(ticket.gameName)} rounded-lg font-semibold text-[10px] flex-shrink-0 shadow-sm border`}>
                  {ticket.gameName}
                </span>
              )}
              {ticket.trend && (
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] flex-shrink-0">{ticket.trend}</span>
              )}
              {ticket.requiresLogin && (
                <span
                  className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] flex-shrink-0"
                  title={t("ticketCard.loginRequiredTitle")}
                >
                  🔒 {t("ticketCard.loginRequired")}
                </span>
              )}
              {ticket.hasKeywordMatch && (
                <span
                  className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] flex-shrink-0"
                  title={t("ticketCard.keywordMatchTitle")}
                >
                  🔑 {t("ticketCard.keywordMatch")}
                </span>
              )}
              {categoryLabel && (
                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] flex-shrink-0">{categoryLabel}</span>
              )}
              {ticket.commentsCount && ticket.commentsCount > 0 && (
                <span
                  className={classNames(
                    "px-1.5 py-0.5 rounded-full text-[10px] flex-shrink-0 font-semibold",
                    ticket.isHotTopic || (ticket.commentsCount && ticket.commentsCount >= 10)
                      ? "bg-red-100 text-red-700 border border-red-300"
                      : "bg-purple-100 text-purple-700"
                  )}
                  title={commentTooltip}
                >
                  {ticket.isHotTopic || (ticket.commentsCount && ticket.commentsCount >= 10) ? "🔥" : "💬"} {ticket.commentsCount}
                </span>
              )}
              {assigneeName && (
                <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] flex-shrink-0">{assigneeName}</span>
              )}
              <div className="flex items-center gap-0.5 text-[10px] text-slate-500 flex-shrink-0">
                <span className="font-semibold">SLA</span>
                {ticket.status === "RESOLVED" || ticket.status === "VERIFIED" ? (
                  <ProcessedTime processedAt={ticket.processedAt} createdAt={ticket.createdAt} />
                ) : (
                  <Countdown to={ticket.slaDeadlineAt} />
                )}
              </div>
              <span className="text-[10px] text-slate-500 flex-shrink-0">
                {t("ticketCard.statusPrefix")}{" "}
                <span className="font-semibold">{statusLabel(ta, ticket.status) || t("ticketCard.unread")}</span>
              </span>
              {ticket.primaryCategory && (
                <span className="text-[10px] text-slate-500 flex-shrink-0">
                  {t("ticketCard.categoryPrefix")} <span className="font-semibold">{ticket.primaryCategory}</span>
                </span>
              )}
            </div>
              </div>
            </div>
          </div>

          {/* Right-side metrics columns (Discourse-like) */}
          {isIssue && (
            <>
              <div className="hidden md:block text-right tabular-nums text-sm text-slate-700 dark:text-slate-200">
                {typeof repliesValue === "number" ? repliesValue : "—"}
              </div>
              <div className="hidden md:block text-right tabular-nums text-sm text-slate-700 dark:text-slate-200">
                {typeof likesValue === "number" ? likesValue : "—"}
              </div>
              <div className="hidden md:block text-right tabular-nums text-sm text-slate-700 dark:text-slate-200">
                {typeof viewsValue === "number" ? viewsValue : "—"}
              </div>
              <div
                className="hidden md:block min-w-0 text-right text-sm text-slate-600 dark:text-slate-300 truncate"
                title={
                  discourseMeta.lastActivityText
                    ? discourseMeta.lastActivityText
                    : ticket.sourceCreatedAt
                      ? formatTime(ticket.sourceCreatedAt)
                      : formatTime(ticket.createdAt)
                }
              >
                {discourseMeta.lastActivityText
                  ? discourseMeta.lastActivityText
                  : ticket.sourceCreatedAt
                    ? formatTime(ticket.sourceCreatedAt)
                    : formatTime(ticket.createdAt)}
              </div>
              <div className="hidden md:flex justify-end">
                {ticket.screenshotPath ? (
                  <img
                    src={`/uploads/${ticket.screenshotPath}`}
                    alt="preview"
                    className="w-[112px] h-[72px] object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`/uploads/${ticket.screenshotPath}`, "_blank");
                    }}
                  />
                ) : discourseMeta.imageUrl ? (
                  <img
                    src={discourseMeta.imageUrl}
                    alt="preview"
                    className="w-[112px] h-[72px] object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(discourseMeta.imageUrl as string, "_blank");
                    }}
                  />
                ) : (
                  <div className="w-[112px] h-[72px] rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-[11px] text-slate-400 flex items-center justify-center">
                    no preview
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
);

TicketCard.displayName = "TicketCard";
