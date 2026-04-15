import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
  type Dispatch,
  type SetStateAction
} from "react";
import type { Ticket, Agent, TicketSeverity } from "../types";
import { loadFiltersFromStorage, saveFiltersToStorage } from "../utils/issueFilterStorage";
import { LEGACY_CAFE_GAME_NAMES_BY_CODE } from "../utils/cafeGameDisplay";

interface IssueContextType {
  tickets: Ticket[];
  agents: Agent[];
  projectAgents: Agent[];
  filter: {
    src?: Ticket["source"] | "all";
    sev?: TicketSeverity | "all";
    cat?: string;
    game?: string | "all";
  };
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  setAgents: Dispatch<SetStateAction<Agent[]>>;
  setProjectAgents: Dispatch<SetStateAction<Agent[]>>;
  setFilter: Dispatch<SetStateAction<{
    src?: Ticket["source"] | "all";
    sev?: TicketSeverity | "all";
    cat?: string;
    game?: string | "all";
  }>>;
  updateTicket: (ticketId: string, updates: Partial<Ticket>) => void;
  filteredTickets: Ticket[];
  highPriorityTickets: Ticket[];
  normalTickets: Ticket[];
}

const IssueContext = createContext<IssueContextType | undefined>(undefined);

export function IssueProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projectAgents, setProjectAgents] = useState<Agent[]>([]);
  const defaultFilter = { src: "all", sev: "all", cat: "all", game: "all" } as const;
  const [filter, setFilter] = useState<{
    src?: Ticket["source"] | "all";
    sev?: TicketSeverity | "all";
    cat?: string;
    game?: string | "all";
  }>(() => {
    const stored = loadFiltersFromStorage()?.filter;
    if (stored && typeof stored === "object") {
      return {
        src: stored.src === "all" || !stored.src ? "all" : (stored.src as Ticket["source"]),
        sev: stored.sev === "all" || stored.sev === undefined ? "all" : (Number(stored.sev) as TicketSeverity),
        cat: stored.cat || "all",
        game: stored.game || "all"
      };
    }
    return { ...defaultFilter };
  });

  useEffect(() => {
    saveFiltersToStorage({ filter });
  }, [filter]);

  // 티켓 업데이트 함수
  const updateTicket = useCallback((ticketId: string, updates: Partial<Ticket>) => {
    setTickets(prev => prev.map(t =>
      t.id === ticketId ? { ...t, ...updates } : t
    ));
  }, []);

  // 필터링된 티켓
  const filteredTickets = useMemo(() => {
    return tickets
      .filter((t) => {
        let sourceMatch = true;
        if (filter.src && filter.src !== "all") {
          sourceMatch = t.source === filter.src;
        }

        let gameMatch = true;
        if (filter.game && filter.game !== "all") {
          const code = (t as { cafeGameCode?: string | null }).cafeGameCode;
          if (code != null && code !== "") {
            gameMatch = code === filter.game;
          } else {
            const ticketGameName = t.gameName || "기타";
            const legacy = LEGACY_CAFE_GAME_NAMES_BY_CODE[filter.game];
            gameMatch =
              ticketGameName === filter.game ||
              (!!legacy && legacy.includes(ticketGameName));
          }
        }

        return (
          sourceMatch &&
          gameMatch &&
          (filter.sev === "all" || t.severity === filter.sev) &&
          (filter.cat === "all" ||
            !filter.cat ||
            (t.categories && t.categories.includes(filter.cat)) ||
            t.primaryCategory === filter.cat)
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt || a.severity - b.severity);
  }, [tickets, filter]);

  // 중요도 높은 이슈 필터링 (severity 1만 표시)
  const highPriorityTickets = useMemo(() => {
    return filteredTickets.filter(t => {
      // 완료된 이슈 제외
      if (t.processedAt || t.status === 'RESOLVED' || t.status === 'VERIFIED') return false;
      // severity 1만 포함
      if (t.severity !== 1) return false;
      return true;
    }).sort((a, b) => {
      // SLA 임박 이슈 우선
      const aSlaUrgent = a.slaDeadlineAt && a.slaDeadlineAt - Date.now() < 600000 && a.slaDeadlineAt > Date.now();
      const bSlaUrgent = b.slaDeadlineAt && b.slaDeadlineAt - Date.now() < 600000 && b.slaDeadlineAt > Date.now();
      if (aSlaUrgent && !bSlaUrgent) return -1;
      if (!aSlaUrgent && bSlaUrgent) return 1;
      
      // 최신순 정렬
      return b.createdAt - a.createdAt;
    });
  }, [filteredTickets]);

  // 전체 이슈: 중요 이슈를 포함한 모든 이슈 표시
  const normalTickets = useMemo(() => filteredTickets, [filteredTickets]);

  const value = useMemo(() => ({
    tickets,
    agents,
    projectAgents,
    filter,
    setTickets,
    setAgents,
    setProjectAgents,
    setFilter,
    updateTicket,
    filteredTickets,
    highPriorityTickets,
    normalTickets
  }), [
    tickets,
    agents,
    projectAgents,
    filter,
    updateTicket,
    filteredTickets,
    highPriorityTickets,
    normalTickets
  ]);

  return (
    <IssueContext.Provider value={value}>
      {children}
    </IssueContext.Provider>
  );
}

export function useIssues() {
  const context = useContext(IssueContext);
  if (context === undefined) {
    throw new Error('useIssues must be used within an IssueProvider');
  }
  return context;
}

