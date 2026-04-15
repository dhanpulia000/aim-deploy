import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatDateToLocalString } from "./CalendarDatePicker";
import type { Agent } from "../types";

interface Schedule {
  id: string;
  agentId: string;
  agent?: {
    id: string;
    name: string;
  };
  scheduleType: "weekly" | "specific";
  dayOfWeek?: number | null;
  specificDate?: string | null;
  startTime: string;
  endTime: string;
  workType?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

interface ScheduleCalendarProps {
  agents: Agent[];
}

/** DB에 저장된 근무 타입 문자열(한글) — 색상 키로 사용 */
const WORK_TYPE_COLORS: Record<string, string> = {
  주간: "bg-blue-100 text-blue-800 border-blue-300",
  오후: "bg-yellow-100 text-yellow-800 border-yellow-300",
  야간: "bg-purple-100 text-purple-800 border-purple-300",
  정오: "bg-orange-100 text-orange-800 border-orange-300",
};

function workTypeKeyByValue(value: string) {
  if (value === "주간") return "day";
  if (value === "오후") return "swing";
  if (value === "야간") return "night";
  if (value === "정오") return "noon";
  return null;
}

export default function ScheduleCalendar({ agents }: ScheduleCalendarProps) {
  const { t, i18n } = useTranslation("pagesAdmin");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSchedules, setSelectedSchedules] = useState<Schedule[]>([]);

  const locale = i18n.language?.toLowerCase().startsWith("ko") ? "ko-KR" : "en-US";

  const workTypeLabel = (value: string) => {
    const key = workTypeKeyByValue(value);
    return key ? t(`admin.workTypes.${key}`) : value;
  };

  const monthYear = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(currentDate),
    [currentDate, locale]
  );

  const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`admin.schedules.days.${i}`));

  const getMonthRange = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    return {
      start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      end: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`,
    };
  };

  useEffect(() => {
    loadSchedules();
  }, [currentDate]);

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const { start, end } = getMonthRange(currentDate);
      const res = await fetch(`/api/schedules/range?startDate=${start}&endDate=${end}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSchedules(data.data || []);
        }
      }
    } catch (error) {
      console.error("Failed to load schedules:", error);
    } finally {
      setLoading(false);
    }
  };

  const getSchedulesForDate = (date: Date): Schedule[] => {
    const dateStr = formatDateToLocalString(date);
    const dayOfWeek = date.getDay();

    const activeAgentIds = new Set(agents.filter((agent) => agent.isActive !== false).map((agent) => agent.id));

    return schedules.filter((schedule) => {
      if (!schedule.isActive) return false;

      if (!schedule.agent || !activeAgentIds.has(schedule.agentId)) {
        return false;
      }

      if (schedule.scheduleType === "weekly") {
        return schedule.dayOfWeek === dayOfWeek;
      }

      if (schedule.scheduleType === "specific") {
        return schedule.specificDate === dateStr;
      }

      return false;
    });
  };

  const getCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  const handleDateClick = (date: Date) => {
    const dateStr = formatDateToLocalString(date);
    setSelectedDate(dateStr);
    setSelectedSchedules(getSchedulesForDate(date));
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const formatLongDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);

  const calendarDays = getCalendarDays();

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-slate-800">{t("admin.scheduleCalendar.title")}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="px-3 py-1 border rounded-lg hover:bg-slate-50"
            >
              {t("admin.scheduleCalendar.prev")}
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="px-3 py-1 border rounded-lg hover:bg-slate-50"
            >
              {t("admin.scheduleCalendar.today")}
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="px-3 py-1 border rounded-lg hover:bg-slate-50"
            >
              {t("admin.scheduleCalendar.next")}
            </button>
          </div>
        </div>
        <div className="text-xl font-semibold text-center text-slate-700 mb-4">{monthYear}</div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-500">{t("admin.scheduleCalendar.loading")}</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-4">
            {dayLabels.map((day, di) => (
              <div
                key={di}
                className="p-2 text-center text-sm font-semibold text-slate-600 bg-slate-50"
              >
                {day}
              </div>
            ))}

            {calendarDays.map((date, idx) => {
              if (!date) {
                return <div key={idx} className="p-2 border border-slate-200 bg-slate-50" />;
              }

              const dateStr = formatDateToLocalString(date);
              const isToday = date.toDateString() === new Date().toDateString();
              const daySchedules = getSchedulesForDate(date);
              const isSelected = selectedDate === dateStr;

              return (
                <div
                  key={idx}
                  className={`p-1 border border-slate-200 min-h-[100px] cursor-pointer hover:bg-slate-50 ${
                    isToday ? "bg-blue-50 border-blue-300" : ""
                  } ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                  onClick={() => handleDateClick(date)}
                  title={t("admin.scheduleCalendar.tooltipDate", {
                    iso: dateStr,
                    long: formatLongDate(date),
                  })}
                >
                  <div
                    className={`text-sm font-medium mb-1 ${
                      isToday ? "text-blue-600" : "text-slate-700"
                    }`}
                  >
                    {date.getDate()}
                  </div>
                  <div className="space-y-1">
                    {daySchedules.slice(0, 3).map((schedule) => (
                      <div
                        key={schedule.id}
                        className={`text-xs px-1 py-0.5 rounded border truncate ${
                          WORK_TYPE_COLORS[schedule.workType || ""] ||
                          "bg-gray-100 text-gray-800 border-gray-300"
                        }`}
                        title={t("admin.scheduleCalendar.agentScheduleTitle", {
                          name: schedule.agent?.name || t("admin.scheduleCalendar.unknownAgent"),
                          start: schedule.startTime,
                          end: schedule.endTime,
                        })}
                      >
                        {schedule.agent?.name || "?"}: {schedule.startTime}~{schedule.endTime}
                      </div>
                    ))}
                    {daySchedules.length > 3 && (
                      <div className="text-xs text-slate-500">
                        {t("admin.scheduleCalendar.moreSchedules", {
                          n: daySchedules.length - 3,
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedDate && selectedSchedules.length > 0 && (
            <div className="mt-6 p-4 bg-slate-50 rounded-lg border">
              <h3 className="text-lg font-semibold mb-3">
                {t("admin.scheduleCalendar.schedulesForDate", { date: selectedDate })}
              </h3>
              <div className="space-y-2">
                {selectedSchedules.map((schedule) => (
                  <div key={schedule.id} className="bg-white p-3 rounded border border-slate-200">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium text-slate-800">
                          {schedule.agent?.name || t("admin.scheduleCalendar.unknownAgent")}
                        </div>
                        <div className="text-sm text-slate-600 mt-1">
                          {schedule.startTime} ~ {schedule.endTime}
                        </div>
                        {schedule.notes && (
                          <div className="text-xs text-slate-500 mt-1">{schedule.notes}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {schedule.workType && (
                          <span
                            className={`text-xs px-2 py-1 rounded border ${
                              WORK_TYPE_COLORS[schedule.workType] ||
                              "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {workTypeLabel(schedule.workType)}
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          {schedule.scheduleType === "weekly"
                            ? t("admin.scheduleCalendar.scheduleTypeWeekly")
                            : t("admin.scheduleCalendar.scheduleTypeSpecific")}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-4 items-center text-sm flex-wrap">
            <span className="font-medium text-slate-700">{t("admin.scheduleCalendar.legend")}</span>
            {Object.keys(WORK_TYPE_COLORS).map((type) => (
              <span key={type} className={`px-2 py-1 rounded border ${WORK_TYPE_COLORS[type]}`}>
                {workTypeLabel(type)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
