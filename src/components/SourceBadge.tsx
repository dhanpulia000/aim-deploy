import { memo } from "react";
import type { Ticket } from "../types";
import { classNames } from "../utils/ticketUtils";

interface SourceBadgeProps {
  src: Ticket["source"];
}

export const SourceBadge = memo<SourceBadgeProps>(({ src }) => {
  const map: Record<Ticket["source"], string> = {
    discord: "bg-indigo-100 text-indigo-700 border-indigo-300",
    naver: "bg-green-100 text-green-700 border-green-300",
    system: "bg-slate-100 text-slate-700 border-slate-300"
  };
  
  return (
    <span className={classNames("px-1.5 py-0.5 text-[10px] rounded-full border", map[src])}>
      {src}
    </span>
  );
});

SourceBadge.displayName = "SourceBadge";












