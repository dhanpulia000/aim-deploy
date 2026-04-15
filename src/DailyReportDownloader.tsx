import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth/AuthContext";
import { LocalizedDateInput } from "./components/LocalizedDateInput";

export default function DailyReportDownloader() {
  const { t } = useTranslation("pagesStandalone");
  const { token, projects } = useAuth();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 오늘 날짜를 기본값으로 설정
  const today = new Date();
  const defaultEndDate = today.toISOString().split('T')[0];
  const defaultStartDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const handleDownload = async () => {
    if (!startDate || !endDate) {
      setError(t("dailyReport.errors.needDates"));
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start > end) {
      setError(t("dailyReport.errors.startAfterEnd"));
      return;
    }

    setDownloading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        startDate,
        endDate
      });

      // 프로젝트 ID가 선택되어 있으면 추가
      if (selectedProjectId && selectedProjectId !== "") {
        params.append('projectId', selectedProjectId);
      }

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/reports/daily/download?${params.toString()}`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: t("dailyReport.errors.downloadFailed") }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // 파일 다운로드
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Content-Disposition 헤더에서 파일명 가져오기
      const contentDisposition = response.headers.get('Content-Disposition');
      let fileName = `daily_report_${startDate}_${endDate}.xlsx`;
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = fileNameMatch[1].replace(/['"]/g, '');
          // URL 디코딩
          try {
            fileName = decodeURIComponent(fileName);
          } catch (e) {
            // 디코딩 실패 시 원본 사용
          }
        }
      }
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      alert(t("dailyReport.alerts.downloaded"));
    } catch (err: any) {
      console.error('일일보고서 다운로드 오류:', err);
      setError(err.message || t("dailyReport.errors.downloadFailedGeneric"));
    } finally {
      setDownloading(false);
    }
  };

  const setQuickDate = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          <a 
            href="/" 
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
          >
            {t("common.backToMain")}
          </a>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h1 className="text-3xl font-bold text-slate-800 mb-6">{t("dailyReport.title")}</h1>
          
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4">{t("dailyReport.quickDates")}</h2>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setQuickDate(1)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
              >
                {t("dailyReport.today")}
              </button>
              <button
                onClick={() => setQuickDate(7)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
              >
                {t("dailyReport.lastDays", { count: 7 })}
              </button>
              <button
                onClick={() => setQuickDate(14)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
              >
                {t("dailyReport.lastDays", { count: 14 })}
              </button>
              <button
                onClick={() => setQuickDate(30)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
              >
                {t("dailyReport.lastDays", { count: 30 })}
              </button>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4">{t("dailyReport.projectSelect")}</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">{t("dailyReport.projectOptional")}</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{t("dailyReport.allProjects")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id.toString()}>
                    {project.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {t("dailyReport.projectHint")}
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4">{t("dailyReport.period")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t("dailyReport.startDate")}</label>
                <LocalizedDateInput
                  type="date"
                  value={startDate || defaultStartDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t("dailyReport.endDate")}</label>
                <LocalizedDateInput
                  type="date"
                  value={endDate || defaultEndDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              onClick={handleDownload}
              disabled={downloading || !startDate || !endDate}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed font-semibold"
            >
              {downloading ? t("dailyReport.downloading") : t("dailyReport.download")}
            </button>
            {startDate && endDate && (
              <div className="text-sm text-slate-600">
                {t("dailyReport.selectedRange", { start: startDate, end: endDate })}
                {selectedProjectId && (
                  <>
                    {" "}
                    |{" "}
                    {t("dailyReport.selectedProject", {
                      name: projects.find((p) => p.id.toString() === selectedProjectId)?.name || selectedProjectId,
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">{t("dailyReport.includedSheetsTitle")}</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• {t("dailyReport.sheets.summary")}</li>
              <li>• {t("dailyReport.sheets.voc")}</li>
              <li>• {t("dailyReport.sheets.issue")}</li>
              <li>• {t("dailyReport.sheets.data")}</li>
              <li>• {t("dailyReport.sheets.index")}</li>
              <li>• {t("dailyReport.sheets.volume")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

