import { useTranslation } from "react-i18next";
import { fmt } from "../utils/formatters";
import type { Ticket, Agent } from "../types";

interface MetricsCardsProps {
  dateFilteredTickets: Ticket[];
  agents: Agent[];
  metricsData: {
    totalIssues: number;
    issuesByStatus: Array<{ status: string; count: number }>;
    todayCount: number;
  };
}

/**
 * 메트릭 카드 섹션 컴포넌트
 */
export function MetricsCards({ dateFilteredTickets, agents, metricsData }: MetricsCardsProps) {
  const { t } = useTranslation("app");
  const statusLabel = (s: string) => t(`status.${s}`, { defaultValue: s });
  return (
    <div className="flex justify-end">
      <div className="flex gap-2 flex-wrap justify-end">
        {/* 열린 이슈 */}
        <div className="rounded-xl border-2 border-slate-200/50 glass-effect p-3 shadow-soft min-w-[100px] hover-lift transition-all">
          <div className="text-[10px] text-slate-500 mb-0.5">{t("metrics.open")}</div>
          <div className="text-lg font-semibold">{dateFilteredTickets.filter(t => ["OPEN","TRIAGED","IN_PROGRESS"].includes(t.status)).length}</div>
        </div>
        
        {/* Sev1 */}
        <div className="rounded-xl border-2 border-red-200/50 bg-gradient-to-br from-red-50 to-red-100/50 p-3 shadow-soft min-w-[80px] hover-lift transition-all">
          <div className="text-[10px] text-slate-500 mb-0.5">{t("metrics.sev1")}</div>
          <div className="text-lg font-semibold text-red-600">{dateFilteredTickets.filter(t => t.severity === 1).length}</div>
        </div>
        
        {/* SLA 임박 */}
        <div className="rounded-xl border-2 border-slate-200/50 glass-effect p-3 shadow-soft min-w-[100px] hover-lift transition-all">
          <div className="text-[10px] text-slate-500 mb-0.5">{t("metrics.slaDue")}</div>
          <div className="text-lg font-semibold">{dateFilteredTickets.filter(t => t.slaDeadlineAt && t.slaDeadlineAt - Date.now() < 600000).length}</div>
        </div>
        
        {/* 평균 처리 중앙값 */}
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm min-w-[120px]">
          <div className="text-[10px] text-slate-500 mb-0.5">{t("metrics.avgHandle")}</div>
          <div className="text-lg font-semibold">{fmt.dur(Math.round(agents.map(a => a.avgHandleSec).sort((a,b)=>a-b)[Math.floor(agents.length/2)] || 0))}</div>
        </div>
        
        {/* 총 이슈 수 */}
        <div className="rounded-xl border-2 border-slate-200/50 glass-effect p-3 shadow-soft min-w-[100px] hover-lift transition-all">
          <div className="text-[10px] text-slate-500 mb-0.5">{t("metrics.total")}</div>
          <div className="text-lg font-semibold">{metricsData.totalIssues.toLocaleString()}</div>
        </div>
        
        {/* 오늘 생성 */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 shadow-sm min-w-[100px]">
          <div className="text-[10px] text-slate-500 mb-0.5">{t("metrics.todayCreated")}</div>
          <div className="text-lg font-semibold text-blue-600">{metricsData.todayCount.toLocaleString()}</div>
        </div>
        
        {/* 상태별 이슈 수 */}
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm min-w-[180px]">
          <div className="text-[10px] text-slate-500 mb-1">{t("metrics.byStatus")}</div>
          <div className="flex flex-wrap gap-1.5">
            {metricsData.issuesByStatus.map((item) => (
              <div key={item.status} className="flex items-center gap-1">
                <span className="text-[9px] font-medium text-slate-600">{statusLabel(item.status)}:</span>
                <span className="text-xs font-bold text-slate-800">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
