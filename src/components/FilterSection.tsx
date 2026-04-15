import { memo } from "react";
import type { Ticket, TicketSeverity } from "../types";

interface FilterSectionProps {
  filter: {
    src?: Ticket["source"] | "all";
    sev?: TicketSeverity | "all";
    cat?: string;
    game?: string | "all";
  };
  availableGames: string[];
  /** cafeGame 코드 → 표시 라벨 (없으면 코드 그대로) */
  gameLabelByCode?: Record<string, string>;
  onFilterChange: (filter: {
    src?: Ticket["source"] | "all";
    sev?: TicketSeverity | "all";
    cat?: string;
    game?: string | "all";
  }) => void;
}

export const FilterSection = memo<FilterSectionProps>(({
  filter,
  availableGames,
  gameLabelByCode,
  onFilterChange
}) => {
  return (
    <div className="flex gap-2 items-center flex-wrap">
      <select
        className="border rounded-md px-2 py-1 bg-white"
        value={filter.game || "all"}
        onChange={(e) => onFilterChange({ ...filter, game: e.target.value as any })}
      >
        <option value="all">전체</option>
        {availableGames.length > 0 && availableGames.map((game) => (
          <option key={game} value={game}>
            {gameLabelByCode?.[game] ?? game}
          </option>
        ))}
      </select>
      <select
        className="border rounded-md px-2 py-1 bg-white"
        value={filter.src || "all"}
        onChange={(e) => onFilterChange({ ...filter, src: e.target.value as any })}
      >
        <option value="all">모든 플랫폼</option>
        <option value="discord">Discord</option>
        <option value="naver">Naver</option>
        <option value="system">System</option>
      </select>
      <select
        className="border rounded-md px-2 py-1 bg-white"
        value={filter.sev}
        onChange={(e) => onFilterChange({ ...filter, sev: (e.target.value === 'all' ? 'all' : Number(e.target.value)) as any })}
      >
        <option value="all">모든 중요도</option>
        <option value={1}>Sev1</option>
        <option value={2}>Sev2</option>
        <option value={3}>Sev3</option>
      </select>
      <select
        className="border rounded-md px-2 py-1 bg-white"
        value={filter.cat || "all"}
        onChange={(e) => onFilterChange({ ...filter, cat: e.target.value === 'all' ? undefined : e.target.value })}
      >
        <option value="all">모든 카테고리</option>
        {/* 카테고리 옵션은 동적으로 생성되어야 함 */}
      </select>
    </div>
  );
});

FilterSection.displayName = "FilterSection";












