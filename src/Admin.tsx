import { useState, useEffect, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, AgentStatus } from "./types";
import ScheduleCalendar from "./components/ScheduleCalendar";
import CalendarDatePicker from "./components/CalendarDatePicker";
import { LocalizedDateInput } from "./components/LocalizedDateInput";
import { useAuth } from "./auth/AuthContext";
import ProjectSelector from "./components/ProjectSelector";
import { Button } from "./components/ui/Button";
import { cn } from "./utils/cn";

// Lazy load admin pages for code splitting
const CategoryManagement = lazy(() => import("./pages/Admin/CategoryManagement"));
const ProjectManagement = lazy(() => import("./pages/Admin/ProjectManagement"));
const AIPromptManagement = lazy(() => import("./pages/Admin/AIPromptManagement"));
const AgentPerformance = lazy(() => import("./pages/Admin/AgentPerformance"));

// 스케줄 타입 정의
interface AgentSchedule {
  id?: string;
  agentId: string;
  scheduleType: "weekly" | "specific";
  dayOfWeek?: number | null; // 0=일요일, 6=토요일
  specificDate?: string | null; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  workType?: string | null; // 주간, 오후, 야간
  isActive?: boolean;
  notes?: string | null;
}

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

// 근무 타입별 기본 시간 설정
const WORK_TYPE_TIMES: Record<string, { startTime: string; endTime: string }> = {
  "주간": { startTime: "07:00", endTime: "16:00" },
  "오후": { startTime: "14:00", endTime: "23:00" },
  "야간": { startTime: "22:00", endTime: "07:00" },
  "정오": { startTime: "12:00", endTime: "21:00" },
};

export default function Admin() {
  const { t } = useTranslation("pagesAdmin");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeTab, setActiveTab] = useState<"agents" | "schedules" | "calendar" | "sla" | "categories" | "projects" | "prompts" | "performance">("agents");
  const { user, token, selectedProjectId, projects, refreshUser } = useAuth();
  
  // SLA 정책 관련 상태
  const [slaPolicies, setSlaPolicies] = useState<any[]>([]);
  const [editingSlaPolicy, setEditingSlaPolicy] = useState<any | null>(null);
  const [showSlaForm, setShowSlaForm] = useState(false);
  const [loadingSla, setLoadingSla] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<AgentSchedule | null>(null);
  const [selectedAgentForSchedule, setSelectedAgentForSchedule] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  // User 계정 생성 관련 상태
  const [agentEmail, setAgentEmail] = useState("");
  const [agentPassword, setAgentPassword] = useState("");
  const [agentNewPassword, setAgentNewPassword] = useState("");
  const [createUserAccount, setCreateUserAccount] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]); // 여러 날짜 선택용
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState<number[]>([]); // 여러 요일 선택용
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    // 현재 년-월로 초기화 (YYYY-MM 형식)
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [includeInactiveSchedules, setIncludeInactiveSchedules] = useState(false);

  const dayOfWeekLabel = (day: number) => {
    const idx = Math.max(0, Math.min(6, day));
    return t(`admin.schedules.days.${idx}`);
  };

  const commonLoadingText = t("common.loading", { ns: "translation" });

  const workTypeKeyByValue = (value: string) => {
    if (value === "주간") return "day";
    if (value === "오후") return "swing";
    if (value === "야간") return "night";
    if (value === "정오") return "noon";
    return null;
  };

  const workTypeLabel = (value: string) => {
    const key = workTypeKeyByValue(value);
    return key ? t(`admin.workTypes.${key}`) : value;
  };

  // 게시판 모니터링 기능은 모니터링 제어 페이지(/admin/monitoring)로 이동됨

  useEffect(() => {
    loadData();
  }, []);

  // 모니터링 URL 기능은 제거됨 (게시판 모니터링으로 대체)

  // 게시판 모니터링 기능은 모니터링 제어 페이지로 이동됨

  // 에이전트 선택 시 스케줄 로드
  useEffect(() => {
    if (selectedAgentForSchedule && activeTab === "schedules") {
      loadSchedules(selectedAgentForSchedule);
    }
  }, [selectedAgentForSchedule, activeTab, includeInactiveSchedules]);

  // 월별 필터링된 스케줄 계산
  const getFilteredSchedulesByMonth = () => {
    if (!selectedMonth) return schedules;
    
    return schedules.filter((schedule) => {
      // 주간 반복 스케줄은 항상 표시 (해당 월의 해당 요일에 적용됨)
      if (schedule.scheduleType === "weekly") {
        return true;
      }
      
      // 특정 날짜 스케줄: YYYY-MM-DD 문자열로 월 비교 (타임존 영향 없음, 말일 28/29/30/31일 포함)
      if (schedule.scheduleType === "specific" && schedule.specificDate) {
        const dateStr = String(schedule.specificDate).slice(0, 10);
        const scheduleMonth = dateStr.slice(0, 7); // "YYYY-MM"
        return scheduleMonth === selectedMonth;
      }
      
      return false;
    });
  };

  const loadData = async () => {
    try {
      // 에이전트 데이터 로드 (새 API 사용)
      const agentsRes = await fetch("/api/agents", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        // 응답 형식: { success: true, data: [...], message: ... }
        if (agentsData.success && agentsData.data) {
          setAgents(agentsData.data || []);
        } else if (Array.isArray(agentsData)) {
          // 레거시 호환: 배열로 직접 반환되는 경우
          setAgents(agentsData);
        } else {
          console.warn("Unexpected agents response format:", agentsData);
        }
      } else {
        console.error("Failed to load agents:", agentsRes.status, agentsRes.statusText);
      }

    } catch (error) {
      console.error("데이터 로드 실패:", error);
    }
  };

  const loadSchedules = async (agentId: string) => {
    try {
      const q = includeInactiveSchedules ? "?includeInactive=true" : "";
      const res = await fetch(`/api/schedules/agent/${agentId}${q}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSchedules(data.data || []);
        }
      }
    } catch (error) {
      console.error("스케줄 로드 실패:", error);
    }
  };

  // SLA 정책 로드
  useEffect(() => {
    if (activeTab === "sla" && selectedProjectId) {
      loadSlaPolicies();
    }
  }, [activeTab, selectedProjectId]);

  const loadSlaPolicies = async () => {
    if (!selectedProjectId || !token) return;
    setLoadingSla(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/sla?includeInactive=true`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSlaPolicies(data.data || data || []);
      }
    } catch (error) {
      console.error("SLA 정책 로드 실패:", error);
    } finally {
      setLoadingSla(false);
    }
  };

  const saveSlaPolicy = async () => {
    if (!editingSlaPolicy || !selectedProjectId || !token) return;
    if (!editingSlaPolicy.severity || !editingSlaPolicy.responseSec || !editingSlaPolicy.channel || !editingSlaPolicy.target) {
      alert(t("admin.alerts.requiredFields"));
      return;
    }

    try {
      const isNew = !editingSlaPolicy.id;
      const url = isNew 
        ? `/api/projects/${selectedProjectId}/sla`
        : `/api/projects/${selectedProjectId}/sla/${editingSlaPolicy.id}`;
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          severity: editingSlaPolicy.severity,
          responseSec: parseInt(editingSlaPolicy.responseSec),
          channel: editingSlaPolicy.channel,
          target: editingSlaPolicy.target,
          isActive: editingSlaPolicy.isActive !== false
        })
      });

      if (res.ok) {
        alert(t("admin.alerts.saved"));
        setEditingSlaPolicy(null);
        setShowSlaForm(false);
        loadSlaPolicies();
      } else {
        const errorData = await res.json().catch(() => ({ message: t("admin.alerts.serverError") }));
        alert(t("admin.alerts.saveFailed", { message: String(errorData.message || `HTTP ${res.status}`) }));
      }
    } catch (error: any) {
      alert(t("admin.alerts.saveFailed", { message: String(error.message) }));
    }
  };

  const deleteSlaPolicy = async (policyId: number) => {
    if (!confirm(t("admin.alerts.confirmDelete"))) return;
    if (!selectedProjectId || !token) return;

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/sla/${policyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        alert(t("admin.alerts.deleted"));
        loadSlaPolicies();
      }
    } catch (error: any) {
      alert(t("admin.alerts.deleteFailed", { message: String(error.message) }));
    }
  };

  const addSlaPolicy = () => {
    if (!selectedProjectId) {
      alert(t("admin.alerts.selectProject"));
      return;
    }
    setEditingSlaPolicy({
      severity: "1",
      responseSec: 600,
      channel: "webhook",
      target: "",
      isActive: true
    });
    setShowSlaForm(true);
  };

  const editSlaPolicy = (policy: any) => {
    setEditingSlaPolicy({ ...policy });
    setShowSlaForm(true);
  };

  const saveAgent = async () => {
    if (!editingAgent) return;
    if (!editingAgent.name || !editingAgent.name.trim()) {
      alert(t("admin.alerts.enterName"));
      return;
    }

    const isNew = !editingAgent.id || editingAgent.id === "" || !agents.find((a) => a.id === editingAgent.id);

    // 새 에이전트이고 User 계정 생성 옵션이 켜져있으면 이메일/비밀번호 검증
    if (isNew && createUserAccount) {
      if (!agentEmail || !agentEmail.trim()) {
        alert(t("admin.alerts.needEmailWhenCreateUser"));
        return;
      }
      if (!agentPassword || agentPassword.length < 6) {
        alert(t("admin.alerts.passwordMinLength"));
        return;
      }
    }

    // 기존 에이전트 비밀번호 변경(선택)
    if (!isNew && agentNewPassword) {
      if (agentNewPassword.length < 6) {
        alert(t("admin.alerts.passwordMinLength"));
        return;
      }
    }

    try {
      const url = isNew ? "/api/agents" : `/api/agents/${editingAgent.id}`;
      const method = isNew ? "POST" : "PUT";

      // 서버에 전송할 데이터 준비 (ID 제외)
      const agentData: any = {
        name: editingAgent.name.trim(),
        status: editingAgent.status,
        handling: editingAgent.handling || 0,
        todayResolved: editingAgent.todayResolved || 0,
        avgHandleSec: editingAgent.avgHandleSec || 0,
        channelFocus: editingAgent.channelFocus || [],
        slackId: editingAgent.slackId || null,
      };

      // 새 에이전트이고 User 계정 생성 옵션이 켜져있으면 추가 데이터 포함
      if (isNew && createUserAccount) {
        agentData.email = agentEmail.trim();
        agentData.password = agentPassword;
        agentData.createUserAccount = true;
      }
      // 기존 에이전트 비밀번호 변경 (User 계정이 연결된 경우에만 성공)
      if (!isNew && agentNewPassword) {
        agentData.password = agentNewPassword;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(agentData),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert(t("admin.alerts.saved"));
          setEditingAgent(null);
          setShowAddForm(false);
          setAgentEmail("");
          setAgentPassword("");
          setAgentNewPassword("");
          setCreateUserAccount(false);
          await loadData();
        } else {
          alert(t("admin.alerts.saveFailed", { message: String(data.message || t("admin.alerts.unknownError")) }));
        }
      } else {
        const errorData = await res.json().catch(() => ({ message: t("admin.alerts.serverError") }));
        alert(
          t("admin.alerts.saveFailed", { message: String(errorData.message || errorData.error || `HTTP ${res.status}`) })
        );
        console.error("Save agent error:", errorData);
      }
    } catch (error: any) {
      alert(t("admin.alerts.saveFailed", { message: String(error.message) }));
      console.error("Save agent exception:", error);
    }
  };

  const deleteAgent = async (id: string) => {
    if (!confirm(t("admin.alerts.confirmDelete"))) return;

    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert(t("admin.alerts.deleted"));
          await loadData();
        }
      }
    } catch (error: any) {
      alert(t("admin.alerts.deleteFailed", { message: String(error.message) }));
    }
  };

  const addAgent = () => {
    // 새 에이전트는 ID 없이 생성 (서버에서 CUID 생성)
    const newAgent: Agent = {
      id: "", // 서버에서 생성
      name: "",
      status: "available",
      handling: 0,
      todayResolved: 0,
      avgHandleSec: 0,
      channelFocus: [],
      isActive: true,
    };
    setEditingAgent(newAgent);
    setAgentEmail("");
    setAgentPassword("");
    setAgentNewPassword("");
    setCreateUserAccount(false);
    setShowAddForm(true);
  };

  const editAgent = (agent: Agent) => {
    setEditingAgent({ ...agent });
    setAgentNewPassword("");
    setShowAddForm(true);
  };

  const addSchedule = () => {
    if (!selectedAgentForSchedule) {
      alert(t("admin.alerts.needAgentSelected"));
      return;
    }
    const newSchedule: AgentSchedule = {
      agentId: selectedAgentForSchedule,
      scheduleType: "weekly",
      dayOfWeek: 1, // 월요일
      startTime: WORK_TYPE_TIMES["주간"].startTime,
      endTime: WORK_TYPE_TIMES["주간"].endTime,
      workType: "주간",
      isActive: true,
    };
    setEditingSchedule(newSchedule);
    setSelectedDaysOfWeek([]);
    setSelectedDates([]);
    setShowScheduleForm(true);
  };

  const editSchedule = (schedule: AgentSchedule) => {
    // workType이 있고 WORK_TYPE_TIMES에 정의되어 있으면 시간을 자동으로 동기화
    const scheduleToEdit = { ...schedule };
    if (schedule.workType && WORK_TYPE_TIMES[schedule.workType]) {
      const times = WORK_TYPE_TIMES[schedule.workType];
      scheduleToEdit.startTime = times.startTime;
      scheduleToEdit.endTime = times.endTime;
    }
    setEditingSchedule(scheduleToEdit);
    // 편집 시에는 단일 값으로 설정
    if (schedule.scheduleType === "weekly") {
      setSelectedDaysOfWeek(schedule.dayOfWeek !== null && schedule.dayOfWeek !== undefined ? [schedule.dayOfWeek] : []);
    } else {
      setSelectedDates(schedule.specificDate ? [schedule.specificDate] : []);
    }
    setShowScheduleForm(true);
  };

  const saveSchedule = async () => {
    if (!editingSchedule) return;
    if (!editingSchedule.startTime || !editingSchedule.endTime) {
      alert(t("admin.alerts.needStartEndTime"));
      return;
    }

    // 여러 선택 항목 검증
    if (editingSchedule.scheduleType === "weekly") {
      if (selectedDaysOfWeek.length === 0) {
        alert(t("admin.alerts.needAtLeastOneDay"));
        return;
      }
    } else {
      if (selectedDates.length === 0) {
        alert(t("admin.alerts.needAtLeastOneDate"));
        return;
      }
    }

    try {
      const isNew = !editingSchedule.id;
      
      // 편집 모드인 경우 기존 스케줄만 업데이트
      if (!isNew) {
        const url = `/api/schedules/${editingSchedule.id}`;
        const scheduleData = {
          ...editingSchedule,
          dayOfWeek: editingSchedule.scheduleType === "weekly" ? (selectedDaysOfWeek[0] ?? null) : null,
          specificDate: editingSchedule.scheduleType === "specific" ? (selectedDates[0] ?? null) : null,
        };
        
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scheduleData),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            alert(t("admin.alerts.saved"));
            setEditingSchedule(null);
            setShowScheduleForm(false);
            setSelectedDaysOfWeek([]);
            setSelectedDates([]);
            if (selectedAgentForSchedule) {
              await loadSchedules(selectedAgentForSchedule);
            }
          }
        }
        return;
      }

      // 새 스케줄 생성: 각 선택 항목마다 별도 스케줄 생성
      const schedulesToCreate: AgentSchedule[] = [];
      
      if (editingSchedule.scheduleType === "weekly") {
        // 각 요일마다 별도 스케줄 생성
        for (const dayOfWeek of selectedDaysOfWeek) {
          schedulesToCreate.push({
            agentId: editingSchedule.agentId,
            scheduleType: "weekly",
            dayOfWeek: dayOfWeek,
            specificDate: null,
            startTime: editingSchedule.startTime,
            endTime: editingSchedule.endTime,
            workType: editingSchedule.workType,
            isActive: editingSchedule.isActive ?? true,
            notes: editingSchedule.notes,
          });
        }
      } else {
        // 각 날짜마다 별도 스케줄 생성
        for (const specificDate of selectedDates) {
          schedulesToCreate.push({
            agentId: editingSchedule.agentId,
            scheduleType: "specific",
            dayOfWeek: null,
            specificDate: specificDate,
            startTime: editingSchedule.startTime,
            endTime: editingSchedule.endTime,
            workType: editingSchedule.workType,
            isActive: editingSchedule.isActive ?? true,
            notes: editingSchedule.notes,
          });
        }
      }

      // 모든 스케줄 생성
      let successCount = 0;
      let failCount = 0;
      
      for (const schedule of schedulesToCreate) {
        try {
          const res = await fetch("/api/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(schedule),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              successCount++;
            } else {
              console.error("Schedule creation failed:", data);
              failCount++;
            }
          } else {
            const errorData = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
            console.error("Schedule creation HTTP error:", res.status, errorData);
            failCount++;
          }
        } catch (error: any) {
          console.error("Schedule creation exception:", error);
          failCount++;
        }
      }

      if (successCount > 0) {
        const suffix =
          failCount > 0 ? t("admin.alerts.scheduleBulkSavedSuffix", { fail: failCount }) : "";
        alert(t("admin.alerts.scheduleBulkSaved", { success: successCount, suffix }));
        setEditingSchedule(null);
        setShowScheduleForm(false);
        setSelectedDaysOfWeek([]);
        setSelectedDates([]);
        if (selectedAgentForSchedule) {
          await loadSchedules(selectedAgentForSchedule);
        }
      } else {
        alert(t("admin.alerts.scheduleSaveFailed"));
      }
    } catch (error: any) {
      alert(t("admin.alerts.saveFailed", { message: String(error.message) }));
      console.error("Save schedule error:", error);
    }
  };

  const deleteSchedule = async (scheduleId: string) => {
    if (!confirm(t("admin.alerts.confirmDelete"))) return;

    try {
      const res = await fetch(`/api/schedules/${scheduleId}`, { method: "DELETE" });
      if (res.ok) {
        alert(t("admin.alerts.deleted"));
        if (selectedAgentForSchedule) {
          await loadSchedules(selectedAgentForSchedule);
        }
      }
    } catch (error: any) {
      alert(t("admin.alerts.deleteFailed", { message: String(error.message) }));
    }
  };



  // 모니터링 게시판 관련 함수들
  // 게시판 모니터링 관련 함수는 모니터링 제어 페이지(/admin/monitoring)로 이동됨

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-slate-800">{t("admin.pageTitle")}</h1>
          <div className="flex gap-3">
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab("agents")}
              className={cn("ui-tab", activeTab === "agents" && "ui-tab-active")}
            >
              {t("admin.tabs.agents", { count: agents.length })}
            </button>
            <button
              onClick={() => setActiveTab("schedules")}
              className={cn("ui-tab", activeTab === "schedules" && "ui-tab-active")}
            >
              {t("admin.tabs.schedules")}
            </button>
            <button
              onClick={() => setActiveTab("calendar")}
              className={cn("ui-tab", activeTab === "calendar" && "ui-tab-active")}
            >
              {t("admin.tabs.scheduleCalendar")}
            </button>
            {(user?.role === "ADMIN" || user?.role === "LEAD") && (
              <>
                <button
                  onClick={() => setActiveTab("sla")}
                  className={cn("ui-tab", activeTab === "sla" && "ui-tab-active")}
                >
                  {t("admin.tabs.sla")}
                </button>
                <button
                  onClick={() => setActiveTab("categories")}
                  className={cn("ui-tab", activeTab === "categories" && "ui-tab-active")}
                >
                  {t("admin.tabs.categories")}
                </button>
                <button
                  onClick={() => setActiveTab("projects")}
                  className={cn("ui-tab", activeTab === "projects" && "ui-tab-active")}
                >
                  {t("admin.tabs.projects")}
                </button>
                <button
                  onClick={() => setActiveTab("prompts")}
                  className={cn("ui-tab", activeTab === "prompts" && "ui-tab-active")}
                >
                  {t("admin.tabs.prompts")}
                </button>
                <button
                  onClick={() => setActiveTab("performance")}
                  className={cn("ui-tab", activeTab === "performance" && "ui-tab-active")}
                >
                  {t("admin.tabs.performance")}
                </button>
              </>
            )}
          </div>
        </div>

        {activeTab === "agents" && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">{t("admin.agents.title")}</h2>
              <Button onClick={addAgent} variant="primary">
                + {t("admin.common.add")}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.email")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.name")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.status")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.handling")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.todayResolved")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.avgHandling")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.games")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.agents.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {agents.map((agent) => (
                    <tr key={agent.id}>
                      <td className="px-4 py-3 text-sm">{agent.email || agent.id}</td>
                      <td className="px-4 py-3 text-sm font-medium">{agent.name}</td>
                      <td className="px-4 py-3 text-sm">{agent.status}</td>
                      <td className="px-4 py-3 text-sm">{agent.handling}</td>
                      <td className="px-4 py-3 text-sm">{agent.todayResolved}</td>
                      <td className="px-4 py-3 text-sm">{t("admin.agents.table.secondsSuffix", { n: agent.avgHandleSec })}</td>
                      <td className="px-4 py-3 text-sm">{agent.channelFocus?.join(", ") || "-"}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Button onClick={() => editAgent(agent)} variant="ghost" size="sm">
                            {t("admin.common.edit")}
                          </Button>
                          <Button onClick={() => deleteAgent(agent.id)} variant="danger" size="sm">
                            {t("admin.common.delete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "schedules" && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t("admin.schedules.agentSelectLabel")}</label>
                <select
                  value={selectedAgentForSchedule || ""}
                  onChange={(e) => {
                    const agentId = e.target.value || null;
                    setSelectedAgentForSchedule(agentId);
                    if (agentId) {
                      loadSchedules(agentId);
                    } else {
                      setSchedules([]);
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={agents.length === 0}
                >
                  <option value="">
                    {agents.length > 0 ? t("admin.schedules.agentSelectPlaceholder") : t("admin.schedules.agentSelectEmpty")}
                  </option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.email || agent.id})
                    </option>
                  ))}
                </select>
                {agents.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">
                    {t("admin.schedules.agentSelectEmptyHintPrefix")}{" "}
                    <button onClick={() => setActiveTab("agents")} className="text-blue-600 hover:underline">
                      {t("admin.schedules.agentSelectEmptyHintLink")}
                    </button>
                    {t("admin.schedules.agentSelectEmptyHintSuffix")}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t("admin.schedules.monthSelectLabel")}</label>
                {(() => {
                  // 최근 12개월~다음 12개월 범위에서만 월 선택을 허용 (표 형태)
                  const now = new Date();
                  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
                  const end = new Date(now.getFullYear(), now.getMonth() + 12, 1);
                  const allowedMonths = new Set<string>();

                  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, "0");
                    allowedMonths.add(`${y}-${m}`);
                  }

                  const years = Array.from(allowedMonths)
                    .map((s) => s.slice(0, 4))
                    .filter((v, idx, arr) => arr.indexOf(v) === idx)
                    .sort();

                  const monthLabels = Array.from({ length: 12 }, (_, i) => i + 1);

                  return (
                    <div className="w-full overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            <th className="sticky left-0 bg-white border border-slate-200 px-2 py-1 text-left font-medium text-slate-700">
                              {t("admin.schedules.year")}
                            </th>
                            {monthLabels.map((m) => (
                              <th
                                key={m}
                                className="border border-slate-200 px-2 py-1 text-center font-medium text-slate-700 bg-white"
                              >
                                {t("admin.schedules.monthSuffix", { n: m })}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {years.map((year) => (
                            <tr key={year}>
                              <td className="sticky left-0 bg-white border border-slate-200 px-2 py-1 text-left text-slate-800 font-medium">
                                {year}
                              </td>
                              {monthLabels.map((m) => {
                                const mm = String(m).padStart(2, "0");
                                const key = `${year}-${mm}`;
                                const enabled = allowedMonths.has(key);
                                const selected = selectedMonth === key;
                                return (
                                  <td key={key} className="border border-slate-200 px-1 py-1 text-center">
                                    <button
                                      type="button"
                                      disabled={!enabled}
                                      onClick={() => enabled && setSelectedMonth(key)}
                                      className={[
                                        "w-full px-2 py-1 rounded",
                                        enabled ? "bg-white hover:bg-slate-50" : "bg-slate-50 text-slate-400 cursor-not-allowed",
                                        selected ? "ring-2 ring-blue-500 border border-blue-300" : "border border-transparent",
                                      ].join(" ")}
                                    >
                                      {enabled ? (
                                        <span className="text-slate-800">{m}</span>
                                      ) : (
                                        <span className="text-slate-400">-</span>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                <p className="mt-1 text-xs text-slate-500">{t("admin.schedules.onlySelectedMonthHint")}</p>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeInactiveSchedules}
                    onChange={(e) => setIncludeInactiveSchedules(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700">{t("admin.schedules.includeInactive")}</span>
                </label>
              </div>
            </div>

            {selectedAgentForSchedule && (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold">
                    {t("admin.schedules.listTitle")}{" "}
                    {t("admin.schedules.listCount", {
                      filtered: getFilteredSchedulesByMonth().length,
                      total: schedules.length,
                    })}
                    {selectedMonth && (
                      <span className="text-sm font-normal text-slate-500 ml-2">
                        {t("admin.schedules.listMonthHint", {
                          year: selectedMonth.split("-")[0],
                          month: parseInt(selectedMonth.split("-")[1]),
                        })}
                      </span>
                    )}
                  </h2>
                  <button
                    onClick={addSchedule}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    + {t("admin.schedules.addSchedule")}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.schedules.table.type")}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.schedules.table.dayOrDate")}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.schedules.table.time")}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.schedules.table.workType")}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.schedules.table.status")}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.schedules.table.actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {getFilteredSchedulesByMonth().map((schedule) => (
                        <tr key={schedule.id}>
                          <td className="px-4 py-3 text-sm">
                            {schedule.scheduleType === "weekly" ? t("admin.schedules.typeWeekly") : t("admin.schedules.typeSpecific")}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {schedule.scheduleType === "weekly"
                              ? dayOfWeekLabel(schedule.dayOfWeek || 0)
                              : schedule.specificDate || "-"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {schedule.startTime} ~ {schedule.endTime}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {schedule.workType ? workTypeLabel(schedule.workType) : "-"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {schedule.isActive ? (
                              <span className="text-green-600">{t("admin.common.active")}</span>
                            ) : (
                              <span className="text-gray-400">{t("admin.common.inactive")}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <Button onClick={() => editSchedule(schedule)} variant="ghost" size="sm">
                                {t("admin.common.edit")}
                              </Button>
                              <Button
                                onClick={() => schedule.id && deleteSchedule(schedule.id)}
                                variant="danger"
                                size="sm"
                                disabled={!schedule.id}
                              >
                                {t("admin.common.delete")}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "calendar" && (
          <ScheduleCalendar agents={agents} />
        )}

        {activeTab === "sla" && (user?.role === "ADMIN" || user?.role === "LEAD") && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="mb-4">
              <ProjectSelector />
            </div>
            {!selectedProjectId ? (
              <div className="text-center text-slate-500 py-8">
                {t("admin.alerts.selectProject")}
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold">
                    {t("admin.sla.title")} ({slaPolicies.length})
                  </h2>
                  <Button onClick={addSlaPolicy} variant="primary">
                    + {t("admin.sla.addPolicy")}
                  </Button>
                </div>
                {loadingSla ? (
                  <div className="text-center text-slate-500 py-8">{commonLoadingText}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.sla.table.severity")}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.sla.table.response")}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.sla.table.channel")}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.sla.table.target")}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.sla.table.status")}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">{t("admin.sla.table.actions")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {slaPolicies.map((policy) => (
                          <tr key={policy.id}>
                            <td className="px-4 py-3 text-sm">{policy.severity}</td>
                            <td className="px-4 py-3 text-sm">
                              {t("admin.agents.table.secondsSuffix", { n: policy.responseSec })} (
                              {t("admin.sla.form.responsePretty", {
                                m: Math.floor(policy.responseSec / 60),
                                s: policy.responseSec % 60,
                              })}
                              )
                            </td>
                            <td className="px-4 py-3 text-sm">{policy.channel}</td>
                            <td className="px-4 py-3 text-sm font-mono text-xs">{policy.target}</td>
                            <td className="px-4 py-3 text-sm">
                              {policy.isActive ? (
                                <span className="text-green-600">{t("admin.common.active")}</span>
                              ) : (
                                <span className="text-gray-400">{t("admin.common.inactive")}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex items-center gap-2">
                                <Button onClick={() => editSlaPolicy(policy)} variant="ghost" size="sm">
                                  {t("admin.common.edit")}
                                </Button>
                                <Button onClick={() => deleteSlaPolicy(policy.id)} variant="danger" size="sm">
                                  {t("admin.common.delete")}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {slaPolicies.length === 0 && (
                      <div className="text-center text-slate-500 py-8">
                        {t("admin.sla.empty")}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "categories" && (user?.role === "ADMIN" || user?.role === "LEAD") && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <Suspense
              fallback={
                <div className="flex items-center justify-center p-8">
                  <div className="text-slate-500">{commonLoadingText}</div>
                </div>
              }
            >
              <CategoryManagement />
            </Suspense>
          </div>
        )}

        {activeTab === "projects" && (user?.role === "ADMIN" || user?.role === "LEAD") && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <Suspense
              fallback={
                <div className="flex items-center justify-center p-8">
                  <div className="text-slate-500">{commonLoadingText}</div>
                </div>
              }
            >
              <ProjectManagement 
                projects={projects} 
                onRefresh={refreshUser}
                token={token}
              />
            </Suspense>
          </div>
        )}

        {activeTab === "prompts" && (user?.role === "ADMIN" || user?.role === "LEAD") && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <div className="text-slate-500">{commonLoadingText}</div>
              </div>
            }
          >
            <AIPromptManagement />
          </Suspense>
        )}

        {activeTab === "performance" && (user?.role === "ADMIN" || user?.role === "LEAD") && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <div className="text-slate-500">{commonLoadingText}</div>
              </div>
            }
          >
            <AgentPerformance />
          </Suspense>
        )}


        {/* 에이전트 편집 폼 */}
        {(showAddForm && editingAgent) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-bold mb-4">
                {agents.find((a) => a.id === editingAgent.id) ? t("admin.agentForm.editTitle") : t("admin.agentForm.addTitle")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.name")}</label>
                  <input
                    type="text"
                    value={editingAgent.name}
                    onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.status")}</label>
                  <select
                    value={editingAgent.status}
                    onChange={(e) => setEditingAgent({ ...editingAgent, status: e.target.value as AgentStatus })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="available">{t("admin.agentForm.statusOptions.available")}</option>
                    <option value="busy">{t("admin.agentForm.statusOptions.busy")}</option>
                    <option value="away">{t("admin.agentForm.statusOptions.away")}</option>
                    <option value="offline">{t("admin.agentForm.statusOptions.offline")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.handling")}</label>
                  <input
                    type="number"
                    value={editingAgent.handling}
                    onChange={(e) => setEditingAgent({ ...editingAgent, handling: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.todayResolved")}</label>
                  <input
                    type="number"
                    value={editingAgent.todayResolved}
                    onChange={(e) => setEditingAgent({ ...editingAgent, todayResolved: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.avgHandleSec")}</label>
                  <input
                    type="number"
                    value={editingAgent.avgHandleSec}
                    onChange={(e) => setEditingAgent({ ...editingAgent, avgHandleSec: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.channelFocusMemo")}</label>
                  <input
                    type="text"
                    value={editingAgent.channelFocus?.join(", ") || ""}
                    onChange={(e) => setEditingAgent({
                      ...editingAgent,
                      channelFocus: e.target.value
                        .split(",")
                        .map(s => s.trim())
                        .filter(s => s)
                    })}
                    placeholder={t("admin.agentForm.channelFocusPlaceholder")}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.agentForm.slackUserId")}</label>
                  <input
                    type="text"
                    value={editingAgent.slackId || ""}
                    onChange={(e) => setEditingAgent({ ...editingAgent, slackId: e.target.value.trim() || null })}
                    placeholder={t("admin.agentForm.slackUserIdPlaceholder")}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {t("admin.agentForm.slackUserHint")}
                  </p>
                </div>
                
                {/* 새 에이전트 추가 시에만 User 계정 생성 옵션 표시 */}
                {!agents.find((a) => a.id === editingAgent.id) && (
                  <>
                    <div className="border-t pt-4 mt-4">
                      <div className="flex items-center mb-3">
                        <input
                          type="checkbox"
                          id="createUserAccount"
                          checked={createUserAccount}
                          onChange={(e) => {
                            setCreateUserAccount(e.target.checked);
                            if (!e.target.checked) {
                              setAgentEmail("");
                              setAgentPassword("");
                            }
                          }}
                          className="mr-2"
                        />
                        <label htmlFor="createUserAccount" className="text-sm font-medium cursor-pointer">
                          {t("admin.agentForm.createLoginAccount")}
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 mb-3">
                        {t("admin.agentForm.createLoginAccountHint")}
                      </p>
                      
                      {createUserAccount && (
                        <div className="space-y-3 bg-slate-50 p-3 rounded-lg">
                          <div>
                            <label className="block text-sm font-medium mb-1">{t("admin.agentForm.email")}</label>
                            <input
                              type="email"
                              value={agentEmail}
                              onChange={(e) => setAgentEmail(e.target.value)}
                              placeholder="agent@example.com"
                              className="w-full px-3 py-2 border rounded-lg"
                              required={createUserAccount}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">{t("admin.agentForm.password")}</label>
                            <input
                              type="password"
                              value={agentPassword}
                              onChange={(e) => setAgentPassword(e.target.value)}
                              placeholder={t("admin.agentForm.passwordPlaceholder")}
                              minLength={6}
                              className="w-full px-3 py-2 border rounded-lg"
                              required={createUserAccount}
                            />
                            <p className="text-xs text-slate-500 mt-1">
                              {t("admin.agentForm.passwordHint")}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 기존 에이전트 수정 시 비밀번호 변경 (선택) */}
                {agents.find((a) => a.id === editingAgent.id) && (
                  <div className="border-t pt-4 mt-4">
                    <label className="block text-sm font-medium mb-1">{t("admin.agentForm.newPasswordOptional")}</label>
                    <input
                      type="password"
                      value={agentNewPassword}
                      onChange={(e) => setAgentNewPassword(e.target.value)}
                      placeholder={t("admin.agentForm.newPasswordPlaceholder")}
                      minLength={6}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      {t("admin.agentForm.newPasswordHint")}
                    </p>
                  </div>
                )}
                
                <div className="flex gap-3">
                  <button
                    onClick={saveAgent}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {t("admin.agentForm.save")}
                  </button>
                  <button
                    onClick={() => { setEditingAgent(null); setShowAddForm(false); }}
                    className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                  >
                    {t("admin.agentForm.cancel")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 스케줄 편집 폼 */}
        {(showScheduleForm && editingSchedule) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-bold mb-4">
                {editingSchedule.id ? t("admin.scheduleForm.editTitle") : t("admin.scheduleForm.addTitle")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.scheduleForm.type")}</label>
                  <select
                    value={editingSchedule.scheduleType}
                    onChange={(e) => setEditingSchedule({ ...editingSchedule, scheduleType: e.target.value as "weekly" | "specific" })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="weekly">{t("admin.scheduleForm.typeWeekly")}</option>
                    <option value="specific">{t("admin.scheduleForm.typeSpecific")}</option>
                  </select>
                </div>
                {editingSchedule.scheduleType === "weekly" ? (
                  <div>
                    <label className="block text-sm font-medium mb-2">{t("admin.scheduleForm.pickDays")}</label>
                    <div className="grid grid-cols-2 gap-2 border rounded-lg p-3 bg-slate-50">
                      {DAYS_OF_WEEK.map((day) => (
                        <label key={day} className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedDaysOfWeek.includes(day)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDaysOfWeek([...selectedDaysOfWeek, day]);
                              } else {
                                setSelectedDaysOfWeek(selectedDaysOfWeek.filter((d) => d !== day));
                              }
                            }}
                            className="mr-2"
                          />
                          <span className="text-sm">
                            {dayOfWeekLabel(day)}
                            {t("admin.scheduleForm.daySuffix")}
                          </span>
                        </label>
                      ))}
                    </div>
                    {selectedDaysOfWeek.length === 0 && (
                      <p className="mt-1 text-xs text-red-500">{t("admin.scheduleForm.needDaysHint")}</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium mb-2">{t("admin.scheduleForm.pickDates")}</label>
                    <div className="space-y-2">
                      {/* 캘린더를 통한 날짜 선택 */}
                      <div className="border rounded-lg p-3 bg-slate-50">
                        <CalendarDatePicker
                          selectedDates={selectedDates}
                          onDatesChange={setSelectedDates}
                        />
                      </div>
                      {/* 또는 직접 입력 */}
                      <div className="flex gap-2">
                        <LocalizedDateInput
                          type="date"
                          id="date-input"
                          className="flex-1 px-3 py-2 border rounded-lg"
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const input = e.target as HTMLInputElement;
                              const date = input.value;
                              if (date && !selectedDates.includes(date)) {
                                setSelectedDates([...selectedDates, date].sort());
                                input.value = "";
                              } else if (date && selectedDates.includes(date)) {
                                alert(t("admin.alerts.dateAlreadyAdded"));
                              }
                            }
                          }}
                          onChange={() => {
                            // 날짜 선택 시 자동으로 추가하지 않음 (추가 버튼 사용)
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const input = document.getElementById("date-input") as HTMLInputElement;
                            const date = input?.value;
                            if (date && !selectedDates.includes(date)) {
                              setSelectedDates([...selectedDates, date].sort());
                              input.value = "";
                            } else if (date && selectedDates.includes(date)) {
                              alert(t("admin.alerts.dateAlreadyAdded"));
                            } else if (!date) {
                              alert(t("admin.alerts.selectDate"));
                            }
                          }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                        >
                          {t("admin.scheduleForm.add")}
                        </button>
                      </div>
                      {selectedDates.length > 0 && (
                        <div className="border rounded-lg p-3 bg-slate-50 max-h-32 overflow-y-auto">
                          <div className="flex flex-wrap gap-2">
                            {selectedDates.map((date, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-3 py-1 bg-white border rounded-md text-sm"
                              >
                                {date}
                                <button
                                  type="button"
                                  onClick={() => setSelectedDates(selectedDates.filter((_, i) => i !== idx))}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedDates.length === 0 && (
                        <p className="text-xs text-red-500">{t("admin.scheduleForm.needDatesHint")}</p>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("admin.scheduleForm.startTime")}</label>
                    <input
                      type="time"
                      value={editingSchedule.startTime}
                      onChange={(e) => setEditingSchedule({ ...editingSchedule, startTime: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("admin.scheduleForm.endTime")}</label>
                    <input
                      type="time"
                      value={editingSchedule.endTime}
                      onChange={(e) => setEditingSchedule({ ...editingSchedule, endTime: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.scheduleForm.workType")}</label>
                  <select
                    value={editingSchedule.workType || ""}
                    onChange={(e) => {
                      const workType = e.target.value || null;
                      // 근무 타입 선택 시 시간 자동 적용 (이미 입력된 시간이 있어도 덮어씀)
                      if (workType && WORK_TYPE_TIMES[workType]) {
                        const times = WORK_TYPE_TIMES[workType];
                        setEditingSchedule((prev) => {
                          if (!prev) return null;
                          return {
                            ...prev,
                            workType: workType,
                            startTime: times.startTime,
                            endTime: times.endTime
                          };
                        });
                      } else {
                        setEditingSchedule((prev) => {
                          if (!prev) return null;
                          return { ...prev, workType: workType };
                        });
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">{t("admin.scheduleForm.workTypeNone")}</option>
                    {Object.entries(WORK_TYPE_TIMES).map(([workType, times]) => (
                      <option key={workType} value={workType}>
                        {workTypeLabel(workType)} ({times.startTime} - {times.endTime})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.scheduleForm.notes")}</label>
                  <textarea
                    value={editingSchedule.notes || ""}
                    onChange={(e) => setEditingSchedule({ ...editingSchedule, notes: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={3}
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editingSchedule.isActive ?? true}
                    onChange={(e) => setEditingSchedule({ ...editingSchedule, isActive: e.target.checked })}
                    className="mr-2"
                  />
                  <label className="text-sm font-medium">{t("admin.scheduleForm.enabled")}</label>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={saveSchedule}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {t("admin.scheduleForm.save")}
                  </button>
                  <button
                    onClick={() => { setEditingSchedule(null); setShowScheduleForm(false); }}
                    className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                  >
                    {t("admin.scheduleForm.cancel")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SLA 정책 편집 폼 */}
        {(showSlaForm && editingSlaPolicy) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-bold mb-4">
                {editingSlaPolicy.id ? t("admin.sla.form.editTitle") : t("admin.sla.form.addTitle")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.sla.form.severity")}</label>
                  <select
                    value={editingSlaPolicy.severity}
                    onChange={(e) => setEditingSlaPolicy({ ...editingSlaPolicy, severity: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="1">1 (Critical)</option>
                    <option value="2">2 (High)</option>
                    <option value="3">3 (Medium)</option>
                    <option value="critical">critical</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.sla.form.responseSec")}</label>
                  <input
                    type="number"
                    value={editingSlaPolicy.responseSec}
                    onChange={(e) => setEditingSlaPolicy({ ...editingSlaPolicy, responseSec: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder={t("admin.sla.form.responsePlaceholder")}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {editingSlaPolicy.responseSec
                      ? t("admin.sla.form.responsePretty", {
                          m: Math.floor(editingSlaPolicy.responseSec / 60),
                          s: editingSlaPolicy.responseSec % 60,
                        })
                      : ""}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.sla.form.channel")}</label>
                  <select
                    value={editingSlaPolicy.channel}
                    onChange={(e) => setEditingSlaPolicy({ ...editingSlaPolicy, channel: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="webhook">Webhook</option>
                    <option value="discord">Discord</option>
                    <option value="slack">Slack</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.sla.form.target")}</label>
                  <input
                    type="text"
                    value={editingSlaPolicy.target}
                    onChange={(e) => setEditingSlaPolicy({ ...editingSlaPolicy, target: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="https://discord.com/api/webhooks/..."
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editingSlaPolicy.isActive !== false}
                    onChange={(e) => setEditingSlaPolicy({ ...editingSlaPolicy, isActive: e.target.checked })}
                    className="mr-2"
                  />
                  <label className="text-sm font-medium">{t("admin.sla.form.enabled")}</label>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={saveSlaPolicy}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {t("admin.sla.form.save")}
                  </button>
                  <button
                    onClick={() => { setEditingSlaPolicy(null); setShowSlaForm(false); }}
                    className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                  >
                    {t("admin.sla.form.cancel")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 모니터링 URL 기능은 모니터링 제어 페이지(/admin/monitoring)로 이동되었습니다 */}
        {/* 주석 처리: 모니터링 URL 관리 코드는 MonitoringControl 페이지로 이동됨
        {false && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">모니터링 URL 관리</h2>
              <button
                onClick={() => {
                  setEditingMonitoredUrl({
                    url: "",
                    cafeGame: "PUBG_PC",
                    label: "",
                    enabled: true,
                    interval: 60
                  });
                  setShowMonitoredUrlForm(true);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                + URL 추가
              </button>
            </div>

            {loadingMonitoredUrls ? (
              <div className="text-center py-8 text-slate-500">로딩 중...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">라벨</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">URL</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">카페</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">상태</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">간격(초)</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">마지막 실행</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">이슈 수</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitoredUrls.map((url) => (
                      <tr key={url.id} className="border-b hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm">{url.label || "-"}</td>
                        <td className="px-4 py-3 text-sm">
                          <a
                            href={url.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline truncate max-w-xs block"
                          >
                            {url.url}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {url.cafeGame === "PUBG_PC" ? "데스크톱" : "모바일"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              url.enabled
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {url.enabled ? "활성" : "비활성"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{url.interval}초</td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {url.lastRunAt
                            ? new Date(url.lastRunAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
                            : "실행 안 됨"}
                        </td>
                        <td className="px-4 py-3 text-sm">{url.issueCount || 0}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                setEditingMonitoredUrl(url);
                                setShowMonitoredUrlForm(true);
                              }}
                              variant="outline"
                              size="sm"
                            >
                              수정
                            </Button>
                            <Button onClick={() => deleteMonitoredUrl(url.id)} variant="danger" size="sm">
                              삭제
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showMonitoredUrlForm && editingMonitoredUrl && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                  <h3 className="text-xl font-semibold mb-4">
                    {editingMonitoredUrl.id ? "URL 수정" : "URL 추가"}
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">URL *</label>
                      <input
                        type="text"
                        value={editingMonitoredUrl.url}
                        onChange={(e) =>
                          setEditingMonitoredUrl({ ...editingMonitoredUrl, url: e.target.value })
                        }
                        placeholder="https://cafe.naver.com/..."
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">네이버 카페 구분 *</label>
                      <select
                        value={editingMonitoredUrl.cafeGame}
                        onChange={(e) =>
                          setEditingMonitoredUrl({ ...editingMonitoredUrl, cafeGame: e.target.value })
                        }
                        className="w-full px-3 py-2 border rounded-lg"
                      >
                        <option value="PUBG_PC">데스크톱 공식 네이버 카페</option>
                        <option value="PUBG_MOBILE">모바일 공식 네이버 카페</option>
                      </select>
                      <p className="text-xs text-slate-500 mt-1">
                        크롤러 내부 분류(PC/모바일 공식 카페). 프로젝트 설정과는 별개입니다.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">라벨</label>
                      <input
                        type="text"
                        value={editingMonitoredUrl.label || ""}
                        onChange={(e) =>
                          setEditingMonitoredUrl({ ...editingMonitoredUrl, label: e.target.value })
                        }
                        placeholder="예: 데스크톱 카페 공지 1"
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">스캔 간격 (초)</label>
                      <input
                        type="number"
                        value={editingMonitoredUrl.interval}
                        onChange={(e) =>
                          setEditingMonitoredUrl({
                            ...editingMonitoredUrl,
                            interval: parseInt(e.target.value) || 60
                          })
                        }
                        min={30}
                        max={3600}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="enabled"
                        checked={editingMonitoredUrl.enabled}
                        onChange={(e) =>
                          setEditingMonitoredUrl({ ...editingMonitoredUrl, enabled: e.target.checked })
                        }
                        className="w-4 h-4"
                      />
                      <label htmlFor="enabled" className="text-sm font-medium">
                        활성화
                      </label>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={saveMonitoredUrl}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => {
                          setEditingMonitoredUrl(null);
                          setShowMonitoredUrlForm(false);
                        }}
                        className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 게시판 모니터링 기능은 모니터링 제어 페이지(/admin/monitoring)로 이동되었습니다 */}
      </div>
    </div>
  );
}
