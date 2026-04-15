import type { AgentStatus } from "../types";
import { classNames } from "../utils/ticketUtils";

interface StatusDotProps {
  status: AgentStatus;
}

/**
 * 에이전트 상태 표시 점 컴포넌트
 */
export function StatusDot({ status }: StatusDotProps) {
  const map: Record<AgentStatus, string> = {
    available: "bg-emerald-500",
    busy: "bg-blue-500",
    away: "bg-amber-500",
    offline: "bg-slate-400",
  };
  return <span className={classNames("inline-block h-2 w-2 rounded-full", map[status])} />;
}
