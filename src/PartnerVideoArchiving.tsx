import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth/AuthContext";
import { Button } from "./components/ui/Button";
import { LocalizedDateInput } from "./components/LocalizedDateInput";

export default function PartnerVideoArchiving() {
  const { t, i18n } = useTranslation("pagesStandalone");
  const excelInputRef = useRef<HTMLInputElement>(null);
  const { token } = useAuth();
  const [date, setDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaStatus, setQuotaStatus] = useState<{
    available: boolean;
    message: string;
    note?: string;
    error?: string;
    dailyQuota?: number;
    used?: number;
    remaining?: number;
    resetTime?: string;
    hoursUntilReset?: number;
    minutesUntilReset?: number;
  } | null>(null);
  const [checkingQuota, setCheckingQuota] = useState(false);
  const [result, setResult] = useState<{
    csvPath?: string | null;
    xlsxPath?: string | null;
    totalVideoCount: number;
    battlegroundsCount?: number;
    otherVideosCount?: number;
    channelCount: number;
    errorCount: number;
    errorDetails?: Array<{ channelName: string; error: string }>;
    period: {
      startDateFormatted: string;
      endDateFormatted: string;
      weekNumber: number;
      year: number;
      yearMonthWeekLabel?: string;
      monthWeekLabel?: string;
    };
  } | null>(null);
  const [progress, setProgress] = useState<{
    total: number;
    processed: number;
    success: number;
    error: number;
    currentChannel: string | null;
    status: 'processing' | 'completed';
    videoCount: number;
  } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
    } else {
      setFile(null);
    }
  };

  // 할당량 상태 확인
  const checkQuotaStatus = async () => {
    setCheckingQuota(true);
    try {
      const headers: HeadersInit = {
        "Accept-Language":
          i18n.language === "ko" ? "ko-KR,ko;q=0.9,en;q=0.8" : "en-US,en;q=0.9,ko;q=0.3",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(
        `/api/youtube/quota-status?lang=${encodeURIComponent(i18n.language === "ko" ? "ko" : "en")}`,
        {
          method: "GET",
          headers,
        }
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const data = body.data || body;
      setQuotaStatus(data);
    } catch (err: any) {
      console.error("Quota status check error:", err);
      setQuotaStatus({
        available: false,
        message: t("partnerArchiving.errors.quotaCheckFailed"),
        error: err.message || t("partnerArchiving.errors.unknownError"),
      });
    } finally {
      setCheckingQuota(false);
    }
  };

  // 마운트·언어 변경 시 할당량 문구를 서버 로케일과 맞춤
  useEffect(() => {
    checkQuotaStatus();
  }, [token, i18n.language]);

  // 진행 상황 폴링
  useEffect(() => {
    if (!jobId || !token) return;

    const pollProgress = async () => {
      try {
        const headers: HeadersInit = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`/api/partner-archiving/progress/${jobId}`, {
          headers,
        });

        if (res.ok) {
          const body = await res.json();
          const progressData = body.data || body;
          setProgress(progressData);

          // 완료되면 폴링 중지
          if (progressData.status === 'completed') {
            setJobId(null);
          }
        } else if (res.status === 404) {
          // 진행 상황이 없으면 (완료 후 삭제됨) 폴링 중지
          setJobId(null);
          setProgress(null);
        }
      } catch (err) {
        console.error("진행 상황 조회 오류:", err);
      }
    };

    // 즉시 한 번 조회
    pollProgress();

    // 1초마다 폴링
    const intervalId = setInterval(pollProgress, 1000);

    return () => clearInterval(intervalId);
  }, [jobId, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError(t("partnerArchiving.errors.needExcel"));
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15 * 60 * 1000); // 15분 타임아웃

    try {
      setLoading(true);
      setResult(null);

      const formData = new FormData();
      formData.append("date", date);
      formData.append("excelFile", file);

      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/partner-archiving/multi-channel-weekly", {
        method: "POST",
        headers,
        body: formData,
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      // jobId를 헤더에서 받기
      const responseJobId = res.headers.get('X-Job-Id');
      if (responseJobId) {
        setJobId(responseJobId);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const status = res.status;
        let errorMessage = body.message || body.error || `HTTP ${status}`;
        
        if (status === 504 || status === 408) {
          errorMessage = t("partnerArchiving.errors.timeout504");
        }
        
        setJobId(null);
        setProgress(null);
        throw new Error(errorMessage);
      }

      const body = await res.json();
      console.log("API 응답:", body);
      const data = body.data || body;
      console.log("결과 데이터:", data);
      console.log("오류 상세:", data.errorDetails);
      setResult(data);
      setProgress(null); // 완료되면 진행 상황 초기화
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("파트너 영상 아카이빙 오류:", err);
      
      let errorMessage = err.message || t("partnerArchiving.errors.failed");
      
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        errorMessage = t("partnerArchiving.errors.timeout15m");
      } else if (err.message?.includes('504') || err.message?.includes('Gateway Timeout')) {
        errorMessage = t("partnerArchiving.errors.timeout504");
      }
      
      setJobId(null);
      setProgress(null);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    const filePath = result?.xlsxPath || result?.csvPath;
    if (!filePath) return;
    
    try {
      // 파일명 추출 (경로에서)
      const filename = filePath.split('/').pop() || 'partner_weekly_archive.xlsx';
      
      // 백엔드 다운로드 엔드포인트 사용
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const res = await fetch(`/api/partner-archiving/download/${encodeURIComponent(filename)}`, {
        method: "GET",
        headers,
      });
      
      if (!res.ok) {
        throw new Error(`${t("partnerArchiving.errors.downloadFailed")}: ${res.status}`);
      }
      
      // Blob으로 변환하여 다운로드
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("다운로드 오류:", err);
      setError(err.message || t("partnerArchiving.errors.downloadFailed"));
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-container py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Button onClick={() => (window.location.href = "/")} variant="outline" size="sm">
            {t("common.backToMain")}
          </Button>
          <Button onClick={checkQuotaStatus} disabled={checkingQuota} variant="outline" size="sm" className="whitespace-nowrap">
            {checkingQuota ? t("partnerArchiving.buttons.checking") : t("partnerArchiving.buttons.checkQuota")}
          </Button>
        </div>

        <div className="ui-card ui-card-pad mb-6">
          <div className="mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">{t("partnerArchiving.title")}</h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed max-w-5xl">
              {t("partnerArchiving.subtitle")}
            </p>
          </div>

          {/* 할당량 상태 표시 */}
          {quotaStatus && (
            <div className={`mb-4 ui-alert ${quotaStatus.available ? "ui-alert-success" : "ui-alert-danger"}`}>
              <div className="flex items-start gap-3">
                <div
                  className={`flex-shrink-0 w-5 h-5 rounded-full mt-0.5 ${
                    quotaStatus.available ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <div className="flex-1">
                  <div className="ui-alert-title">{quotaStatus.message}</div>
                  {quotaStatus.note && (
                    <div className="ui-alert-body">{quotaStatus.note}</div>
                  )}
                  {quotaStatus.available && quotaStatus.dailyQuota && (
                    <div className="ui-alert-muted">
                      <div className="flex items-center gap-2">
                        <span>{t("partnerArchiving.quota.daily", { n: quotaStatus.dailyQuota.toLocaleString() })}</span>
                        {quotaStatus.used !== undefined && quotaStatus.remaining !== undefined && (
                          <span className="text-blue-700 dark:text-blue-200 font-semibold">
                            {t("partnerArchiving.quota.usedRemaining", {
                              used: quotaStatus.used.toLocaleString(),
                              remaining: quotaStatus.remaining.toLocaleString(),
                            })}
                          </span>
                        )}
                      </div>
                      {quotaStatus.remaining !== undefined && quotaStatus.dailyQuota && (
                        <div className="mt-1">
                          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                            <div 
                              className={`h-2 rounded-full ${
                                quotaStatus.remaining / quotaStatus.dailyQuota > 0.3 
                                  ? 'bg-green-500' 
                                  : quotaStatus.remaining / quotaStatus.dailyQuota > 0.1
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ 
                                width: `${(quotaStatus.remaining / quotaStatus.dailyQuota) * 100}%` 
                              }}
                            />
                          </div>
                        </div>
                      )}
                      {quotaStatus.hoursUntilReset !== undefined && (
                        <div className="mt-1">
                          {t("partnerArchiving.quota.untilReset", {
                            h: quotaStatus.hoursUntilReset,
                            m: quotaStatus.minutesUntilReset ?? 0,
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {quotaStatus.error && (
                    <div className="ui-alert-muted">{quotaStatus.error}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
              <div className="ui-field">
                <label className="ui-label">{t("partnerArchiving.form.referenceDate")}</label>
                <LocalizedDateInput
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="ui-input"
                />
                <p className="ui-hint mt-2">
                  {t("partnerArchiving.form.referenceHint")}
                </p>
                <p className="ui-hint mt-1 text-amber-600 dark:text-amber-300 font-medium">
                  {t("partnerArchiving.form.referenceWarn")}
                </p>
              </div>

              <div className="ui-field">
                <label className="ui-label">{t("partnerArchiving.form.excelLabel")}</label>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="sr-only"
                  id="partner-archiving-excel"
                />
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => excelInputRef.current?.click()}
                  >
                    {t("partnerArchiving.form.chooseFile")}
                  </Button>
                  <span className="text-sm text-slate-600 dark:text-slate-300 truncate min-w-0 flex-1">
                    {file ? file.name : t("partnerArchiving.form.noFileChosen")}
                  </span>
                </div>
                <p className="ui-hint mt-2">
                  {t("partnerArchiving.form.excelHintPrefix")} {t("partnerArchiving.form.excelHintColumns")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <a
                    href="/partner_channel_list_template.xlsx"
                    download="partner_channel_list_template.xlsx"
                    className="font-semibold text-blue-600 dark:text-blue-300 hover:underline"
                  >
                    {t("partnerArchiving.buttons.downloadTemplate")}
                  </a>
                  <span className="text-amber-700 dark:text-amber-300 font-semibold">
                    {t("partnerArchiving.form.channelIdHint")}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {t("partnerArchiving.form.channelIdExample")}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="ui-alert ui-alert-danger">
                {error}
              </div>
            )}

            {/* 진행 상황 표시 */}
            {progress && progress.total > 0 && (
              <div className="ui-alert ui-alert-info">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">
                    {t("partnerArchiving.progress.title", { processed: progress.processed, total: progress.total })}
                  </div>
                  <div className="text-sm text-blue-700 dark:text-blue-200">
                    {progress.status === "completed"
                      ? t("partnerArchiving.progress.completed")
                      : `${Math.round((progress.processed / progress.total) * 100)}%`}
                  </div>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 mb-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min((progress.processed / progress.total) * 100, 100)}%`
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs text-blue-800 dark:text-blue-100">
                  <div>
                    <span className="font-medium">{t("partnerArchiving.progress.success")}</span>{" "}
                    {t("partnerArchiving.units.count", { n: progress.success })}
                  </div>
                  <div>
                    <span className="font-medium">{t("partnerArchiving.progress.error")}</span>{" "}
                    {t("partnerArchiving.units.count", { n: progress.error })}
                  </div>
                  <div>
                    <span className="font-medium">{t("partnerArchiving.progress.videos")}</span>{" "}
                    {t("partnerArchiving.units.count", { n: progress.videoCount.toLocaleString() })}
                  </div>
                  {progress.currentChannel && (
                    <div className="col-span-2">
                      <span className="font-medium">{t("partnerArchiving.progress.current")}</span> {progress.currentChannel}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={loading} variant="primary">
                {loading ? t("partnerArchiving.buttons.collecting") : t("partnerArchiving.buttons.collect")}
              </Button>

              {result && (result.csvPath || result.xlsxPath) && (
                <Button type="button" onClick={handleDownload} variant="secondary">
                  {t("partnerArchiving.buttons.downloadExcel")}
                </Button>
              )}
            </div>
          </form>
        </div>

        {result && (
          <div className="ui-card ui-card-pad">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">{t("partnerArchiving.result.title")}</h2>
            <div className="mb-4 ui-alert ui-alert-info">
              <div className="text-sm">
                <span className="font-semibold">{t("partnerArchiving.result.period")}</span> {result.period.startDateFormatted} ~ {result.period.endDateFormatted}
                <br />
                <span className="text-xs text-blue-700 dark:text-blue-200 mt-1 block">
                  {t("partnerArchiving.result.periodHint")}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-700">
              <div>
                <div className="text-slate-500 mb-1">{t("partnerArchiving.result.weekLabel")}</div>
                <div className="font-medium">
                  {result.period.yearMonthWeekLabel ??
                    t("partnerArchiving.result.weekFallback", {
                      year: result.period.year,
                      week: result.period.weekNumber,
                    })}
                  <span className="ml-2 text-xs text-slate-500">
                    ({result.period.startDateFormatted} ~ {result.period.endDateFormatted})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">{t("partnerArchiving.result.totalVideos")}</div>
                <div className="font-medium">{t("partnerArchiving.units.count", { n: result.totalVideoCount.toLocaleString() })}</div>
              </div>
              {result.battlegroundsCount !== undefined && (
                <div>
                  <div className="text-slate-500 mb-1">{t("partnerArchiving.result.bgVideos")}</div>
                  <div className="font-medium text-blue-600">
                    {t("partnerArchiving.units.count", { n: result.battlegroundsCount.toLocaleString() })}
                  </div>
                </div>
              )}
              {result.otherVideosCount !== undefined && (
                <div>
                  <div className="text-slate-500 mb-1">{t("partnerArchiving.result.otherVideos")}</div>
                  <div className="font-medium text-slate-600">
                    {t("partnerArchiving.units.count", { n: result.otherVideosCount.toLocaleString() })}
                  </div>
                </div>
              )}
              <div>
                <div className="text-slate-500 mb-1">{t("partnerArchiving.result.successChannels")}</div>
                <div className="font-medium">{t("partnerArchiving.units.count", { n: result.channelCount })}</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">{t("partnerArchiving.result.errorChannels")}</div>
                <div className="font-medium text-red-600">{t("partnerArchiving.units.count", { n: result.errorCount })}</div>
              </div>
            </div>
            {result.errorCount > 0 && (
              <div className="mt-4">
                <div className="text-slate-500 mb-2 text-sm font-medium">
                  {t("partnerArchiving.result.errorDetailsTitle", { count: result.errorCount })}
                </div>
                {result.errorDetails && result.errorDetails.length > 0 ? (
                  <div className="max-h-60 overflow-y-auto text-xs text-red-600 space-y-1 border border-red-200 rounded p-2 bg-red-50">
                    {result.errorDetails.map((err, idx) => (
                      <div key={idx} className="p-2 bg-white rounded border border-red-200 mb-1">
                        <div className="font-medium text-red-700">
                          {err.channelName || t("partnerArchiving.result.unknownChannel")}
                        </div>
                        <div className="text-red-600 mt-1">{err.error || t("partnerArchiving.result.noErrorInfo")}</div>
                      </div>
                    ))}
                    {result.errorCount > result.errorDetails.length && (
                      <div className="text-xs text-slate-500 mt-2 p-2 bg-slate-50 rounded">
                        {t("partnerArchiving.result.moreErrors", {
                          count: result.errorCount - result.errorDetails.length,
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 p-2 bg-slate-50 rounded border border-slate-200">
                    {t("partnerArchiving.result.noErrorDetails")}
                  </div>
                )}
              </div>
            )}
            {(result.xlsxPath || result.csvPath) && (
              <p className="mt-4 text-xs text-slate-500 break-all">
                {t("partnerArchiving.result.filePath")} {result.xlsxPath || result.csvPath}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

