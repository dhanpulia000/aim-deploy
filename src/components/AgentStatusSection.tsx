import { useTranslation } from "react-i18next";
import { StatusDot } from "./StatusDot";
import { fmt } from "../utils/formatters";
import type { Agent } from "../types";

interface AgentStatusSectionProps {
  agents: Agent[];
  projectAgents: Agent[];
  currentAgentId: string | null;
  loadingAgents: boolean;
  agentsLoadError: string | null;
}

/**
 * 에이전트 상태 섹션 컴포넌트
 */
export function AgentStatusSection({
  agents,
  projectAgents,
  currentAgentId,
  loadingAgents,
  agentsLoadError
}: AgentStatusSectionProps) {
  const { t } = useTranslation("app");
  // projectAgents를 우선 사용, 없으면 agents 사용
  const displayAgents = projectAgents.length > 0 ? projectAgents : agents;
  
  if (loadingAgents) {
    return (
      <div className="bg-white/60 backdrop-blur-sm rounded-xl p-3 shadow-soft">
        <h3 className="text-xs font-semibold mb-1.5 px-1 text-slate-600">{t("agentStatus.title")}</h3>
        <div className="text-center text-slate-400 text-xs py-3">
          {t("agentStatus.loading")}
        </div>
      </div>
    );
  }
  
  if (agentsLoadError) {
    return (
      <div className="bg-white/60 backdrop-blur-sm rounded-xl p-3 shadow-soft">
        <h3 className="text-xs font-semibold mb-1.5 px-1 text-slate-600">{t("agentStatus.title")}</h3>
        <div className="text-center text-red-400 text-xs py-3">
          {agentsLoadError}
        </div>
      </div>
    );
  }
  
  if (displayAgents.length === 0) {
    return (
      <div className="bg-white/60 backdrop-blur-sm rounded-xl p-3 shadow-soft">
        <h3 className="text-xs font-semibold mb-1.5 px-1 text-slate-600">{t("agentStatus.title")}</h3>
        <div className="text-center text-slate-400 text-xs py-3">
          {t("agentStatus.empty")}
        </div>
      </div>
    );
  }
  
  // 현재 시간(KST)에 근무 중인 에이전트 확인 함수
  const isAgentOnDuty = (agent: Agent): boolean => {
    if (!agent.schedules || !Array.isArray(agent.schedules) || agent.schedules.length === 0) {
      return false;
    }
    
    const now = new Date();
    // UTC 시간을 KST(UTC+9)로 변환
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentHour = kstTime.getUTCHours();
    const currentMinute = kstTime.getUTCMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const currentDayOfWeek = kstTime.getUTCDay(); // 0=일요일, 1=월요일, ..., 6=토요일
    const currentDateStr = kstTime.toISOString().split('T')[0]; // YYYY-MM-DD
    
    for (const schedule of agent.schedules) {
      if (!schedule.isActive) continue;
      
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      const startTimeInMinutes = startHour * 60 + startMinute;
      const endTimeInMinutes = endHour * 60 + endMinute;
      const isOvernight = endTimeInMinutes < startTimeInMinutes;
      
      let isMatch = false;
      
      if (schedule.scheduleType === 'weekly') {
        // 주간 반복 스케줄
        if (schedule.dayOfWeek === currentDayOfWeek) {
          if (isOvernight) {
            // 야간 근무: 시작 시간 이후 또는 종료 시간 이전
            isMatch = currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
          } else {
            // 일반 근무: 시작 시간과 종료 시간 사이
            isMatch = currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
          }
        }
      } else if (schedule.scheduleType === 'specific') {
        // 특정 날짜 스케줄
        if (schedule.specificDate === currentDateStr) {
          if (isOvernight) {
            // 야간 근무: 시작 시간 이후 또는 종료 시간 이전
            isMatch = currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
          } else {
            // 일반 근무: 시작 시간과 종료 시간 사이
            isMatch = currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
          }
        }
      }
      
      if (isMatch) {
        return true;
      }
    }
    
    return false;
  };
  
  // 로그인 중인 에이전트와 그렇지 않은 에이전트로 분리
  const loggedInAgents = displayAgents.filter(a => a.id === currentAgentId);
  const loggedOutAgents = displayAgents.filter(a => a.id !== currentAgentId);
  
  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-xl p-3 shadow-soft">
      <h3 className="text-xs font-semibold mb-1.5 px-1 text-slate-600">{t("agentStatus.title")}</h3>
      <div className="space-y-1.5">
        {/* 로그인 중인 에이전트 */}
        {loggedInAgents.length > 0 && (
          <>
            <div className="text-[10px] font-semibold text-slate-600 mb-1 px-1">{t("agentStatus.loggedIn")}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-1.5">
              {loggedInAgents.map(a => {
                const isOnDuty = isAgentOnDuty(a);
                return (
                  <div key={a.id} className="rounded-xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 hover:shadow-medium transition-all hover-lift">
                    <div className="flex items-center gap-1 mb-1.5">
                      <div className="h-5 w-5 rounded-full bg-blue-200 flex items-center justify-center font-semibold text-blue-700 text-[10px] flex-shrink-0">{a.name[0]}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-xs flex items-center gap-0.5">
                          <span className="truncate">{a.name}</span> <StatusDot status={a.status} />
                          {isOnDuty && (
                            <span className="ml-1 px-1.5 py-0.5 bg-green-500 text-white text-[8px] rounded-full font-semibold whitespace-nowrap">
                              {t("agentStatus.onDuty")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <div className="text-center flex-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">{t("agentStatus.today")}</div>
                        <div className="font-semibold leading-tight text-sm">{a.todayResolved}</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">{t("agentStatus.inProgress")}</div>
                        <div className="font-semibold leading-tight text-sm">{a.handling}</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">{t("agentStatus.avg")}</div>
                        <div className="font-semibold text-[10px] leading-tight">{fmt.dur(a.avgHandleSec)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        
        {/* 로그인하지 않은 에이전트 */}
        {loggedOutAgents.length > 0 && (
          <>
            {loggedInAgents.length > 0 && (
              <div className="text-[10px] font-semibold text-slate-600 mb-1 px-1 mt-1.5">{t("agentStatus.otherAgents")}</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-1.5">
              {loggedOutAgents.map(a => {
                const isOnDuty = isAgentOnDuty(a);
                return (
                  <div key={a.id} className="rounded-xl border-2 border-slate-200 bg-white/80 backdrop-blur-sm p-3 hover:shadow-medium transition-all hover-lift">
                    <div className="flex items-center gap-1 mb-1.5">
                      <div className="h-5 w-5 rounded-full bg-slate-200 flex items-center justify-center font-semibold text-[10px] flex-shrink-0">{a.name[0]}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-xs flex items-center gap-0.5">
                          <span className="truncate">{a.name}</span> <StatusDot status={a.status} />
                          {isOnDuty && (
                            <span className="ml-1 px-1.5 py-0.5 bg-green-500 text-white text-[8px] rounded-full font-semibold whitespace-nowrap">
                              {t("agentStatus.onDuty")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <div className="text-center flex-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">{t("agentStatus.today")}</div>
                        <div className="font-semibold leading-tight text-sm">{a.todayResolved}</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">{t("agentStatus.inProgress")}</div>
                        <div className="font-semibold leading-tight text-sm">{a.handling}</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">{t("agentStatus.avg")}</div>
                        <div className="font-semibold text-[10px] leading-tight">{fmt.dur(a.avgHandleSec)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
