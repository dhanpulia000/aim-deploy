import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface CalendarDatePickerProps {
  selectedDates: string[];
  onDatesChange: (dates: string[]) => void;
}

// 로컬 시간대 기준으로 YYYY-MM-DD 형식의 날짜 문자열 생성 (UTC 변환 방지)
export function formatDateToLocalString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function CalendarDatePicker({ selectedDates, onDatesChange }: CalendarDatePickerProps) {
  const { t, i18n } = useTranslation("pagesAdmin");
  const [currentDate, setCurrentDate] = useState(new Date());

  const locale = i18n.language?.toLowerCase().startsWith("ko") ? "ko-KR" : "en-US";
  const monthYear = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(currentDate),
    [currentDate, locale]
  );

  // 현재 월의 첫 날과 마지막 날 계산
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

    if (selectedDates.includes(dateStr)) {
      onDatesChange(selectedDates.filter((d) => d !== dateStr));
    } else {
      onDatesChange([...selectedDates, dateStr].sort());
    }
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const calendarDays = getCalendarDays();
  const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`admin.schedules.days.${i}`));

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-3">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="px-2 py-1 text-sm border rounded hover:bg-slate-100"
        >
          ←
        </button>
        <span className="text-sm font-semibold">{monthYear}</span>
        <button
          type="button"
          onClick={handleNextMonth}
          className="px-2 py-1 text-sm border rounded hover:bg-slate-100"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dayLabels.map((day, di) => (
          <div key={di} className="p-1 text-center text-xs font-semibold text-slate-600">
            {day}
          </div>
        ))}

        {calendarDays.map((date, idx) => {
          if (!date) {
            return <div key={idx} className="p-1 aspect-square" />;
          }

          const dateStr = formatDateToLocalString(date);
          const isToday = date.toDateString() === new Date().toDateString();
          const isSelected = selectedDates.includes(dateStr);
          const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleDateClick(date)}
              className={`p-1 aspect-square text-xs border rounded hover:bg-blue-50 transition-colors ${
                isToday ? "bg-blue-100 border-blue-300 font-semibold" : ""
              } ${isSelected ? "bg-blue-500 text-white border-blue-600 font-semibold" : ""} ${
                isPast ? "opacity-50" : ""
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 text-xs text-slate-500 text-center">{t("admin.calendarDatePicker.pickHint")}</div>
    </div>
  );
}
