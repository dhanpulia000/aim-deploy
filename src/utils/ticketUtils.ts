import type { Ticket, Agent } from "../types";

/**
 * CSS 클래스를 결합하는 유틸리티 함수
 */
export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * 게시판명 등 불필요한 프리픽스를 제거한 표시용 제목
 */
export function sanitizeTitle(title?: string | null): string {
  if (!title) return "";
  let result = title.trim();

  // 패턴: [PC 카페 전체글] 실제 제목, [모바일 버그 게시판] 실제 제목 등
  const bracketMatch = result.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (bracketMatch) {
    const prefix = bracketMatch[1];
    const rest = bracketMatch[2];
    // 프리픽스에 '게시판', '카페', '전체글' 등이 포함되면 제거
    if (/(게시판|카페|전체글)/i.test(prefix)) {
      result = rest.trim();
    }
  }

  return result;
}

/**
 * 티켓의 담당자 이름을 가져옵니다
 */
export function getAssigneeName(
  ticket: Ticket,
  projectAgents: Agent[],
  agents: Agent[]
): string | null {
  // 1. 이미 이름이 있으면 사용
  if (ticket.assignedAgentName) return ticket.assignedAgentName;
  
  // 2. assigneeId로 에이전트 찾기 (projectAgents 우선, 없으면 agents에서 찾기)
  if (ticket.assigneeId) {
    const agent = projectAgents.find(a => a.id === ticket.assigneeId) || agents.find(a => a.id === ticket.assigneeId);
    if (agent) return agent.name;
  }
  
  // 3. assignedAgentId로 에이전트 찾기 (projectAgents 우선, 없으면 agents에서 찾기)
  if (ticket.assignedAgentId) {
    const agent = projectAgents.find(a => a.id === ticket.assignedAgentId) || agents.find(a => a.id === ticket.assignedAgentId);
    if (agent) return agent.name;
  }
  
  // 4. 이름을 찾지 못한 경우 null 반환 (ID 표시 방지)
  return null;
}

/**
 * 상태를 한글로 매핑하는 객체
 */
export const statusLabelMap: Record<string, string> = {
  OPEN: "열림",
  TRIAGED: "분류됨",
  IN_PROGRESS: "진행중",
  RESOLVED: "완료",
  CLOSED: "닫힘",
};

/**
 * 심각도에 따른 색상 클래스 반환
 */
export function sevColor(severity: number): string {
  const map: Record<number, string> = {
    1: "bg-red-100 text-red-700 border-red-300",
    2: "bg-orange-100 text-orange-700 border-orange-300",
    3: "bg-yellow-100 text-yellow-700 border-yellow-300",
    4: "bg-blue-100 text-blue-700 border-blue-300",
  };
  return map[severity] || "bg-slate-100 text-slate-700 border-slate-300";
}

/**
 * 행 배경색 클래스 반환
 */
export function getRowBgColor(
  severity: number,
  isChecked: boolean,
  isProcessed: boolean,
  _gameName?: string | null,
  _trend?: string | null
): string {
  if (isProcessed) {
    return "bg-slate-50 border-slate-200";
  }
  if (isChecked) {
    return "bg-blue-50 border-blue-200";
  }
  if (severity === 1) {
    return "bg-red-50 border-red-200";
  }
  if (severity === 2) {
    return "bg-orange-50 border-orange-200";
  }
  return "bg-white border-slate-200";
}

/**
 * 게임 이름에 따른 배지 클래스 반환
 */
export function gameBadgeClass(gameName?: string | null): string {
  const g = String(gameName || "").trim();
  const legacy: Record<string, string> = {
    "PUBG PC": "bg-blue-100 text-blue-700 border-blue-300",
    "PUBG MOBILE": "bg-green-100 text-green-700 border-green-300",
    "PUBG Mobile": "bg-green-100 text-green-700 border-green-300",
    "PUBG NEW STATE": "bg-purple-100 text-purple-700 border-purple-300",
    "PUBG ESPORTS": "bg-orange-100 text-orange-700 border-orange-300"
  };
  if (legacy[g]) return legacy[g];
  if (!g) return "bg-slate-100 text-slate-700 border-slate-300";
  if (/모바일|mobile|pubgm/i.test(g) && !/데스크톱|desktop|pubg\s*pc/i.test(g)) {
    return "bg-green-100 text-green-700 border-green-300";
  }
  if (/데스크톱|desktop|pubg\s*pc|공식\s*pc/i.test(g)) {
    return "bg-blue-100 text-blue-700 border-blue-300";
  }
  return "bg-slate-100 text-slate-700 border-slate-300";
}

/**
 * 상태에 따른 pill 클래스 반환
 */
export function statusPillClass(status: string): string {
  const map: Record<string, string> = {
    OPEN: "bg-red-100 text-red-700",
    TRIAGED: "bg-yellow-100 text-yellow-700",
    IN_PROGRESS: "bg-blue-100 text-blue-700",
    RESOLVED: "bg-green-100 text-green-700",
    CLOSED: "bg-slate-100 text-slate-700",
  };
  return map[status] || "bg-slate-100 text-slate-700";
}

/**
 * 게임에 따른 accent 클래스 반환
 */
export function gameAccentClass(gameName?: string | null): string {
  const g = String(gameName || "").trim();
  const legacy: Record<string, string> = {
    "PUBG PC": "border-l-4 border-l-blue-500",
    "PUBG MOBILE": "border-l-4 border-l-green-500",
    "PUBG Mobile": "border-l-4 border-l-green-500",
    "PUBG NEW STATE": "border-l-4 border-l-purple-500",
    "PUBG ESPORTS": "border-l-4 border-l-orange-500"
  };
  if (legacy[g]) return legacy[g];
  if (/모바일|mobile|pubgm/i.test(g) && !/데스크톱|desktop|pubg\s*pc/i.test(g)) {
    return "border-l-4 border-l-green-500";
  }
  if (/데스크톱|desktop|pubg\s*pc|공식\s*pc/i.test(g)) {
    return "border-l-4 border-l-blue-500";
  }
  return "";
}

/**
 * 리스트 행 배경색 클래스 반환
 */
export function listRowBackgroundClass(isProcessed: boolean, isChecked: boolean): string {
  if (isProcessed) {
    return "bg-slate-50";
  }
  if (isChecked) {
    return "bg-blue-50";
  }
  return "bg-white";
}
