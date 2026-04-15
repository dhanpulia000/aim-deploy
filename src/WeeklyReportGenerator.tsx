import { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/Button";
import { cn } from "./utils/cn";
import { useAuth } from "./auth/AuthContext";
import { useCrawlerGames } from "./hooks/useCrawlerGames";
import { LocalizedDateInput } from "./components/LocalizedDateInput";

type Platform = "pc" | "mobile";

type PubgmSource = { sourceId: string; name: string; size: number; uploadedAt?: string };
type PubgmOutput = { jobId: string; file: string; periodStart: string | null; periodEnd: string | null; createdAt?: string };

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getWeekRange = (reference: Date) => {
  const ref = new Date(reference);
  const day = ref.getDay(); // 0 Sun
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(0, 0, 0, 0);

  return {
    start: formatDate(monday),
    end: formatDate(sunday)
  };
};

const getLastWeekRange = () => {
  const today = new Date();
  const ref = new Date(today);
  ref.setDate(today.getDate() - 7);
  return getWeekRange(ref);
};

/** API JSON 본문 (게이트웨이 HTML 오류 페이지는 파싱하지 않음 → Unexpected token '<' 방지) */
type ApiJson = {
  success?: boolean;
  data?: unknown;
  error?: unknown;
  message?: unknown;
};

async function readResponseJson(res: Response): Promise<{ json: ApiJson | null; isHtml: boolean }> {
  const text = await res.text();
  const t = text.trim();
  if (t.startsWith("<") || t.startsWith("<!")) {
    return { json: null, isHtml: true };
  }
  if (!t) return { json: null, isHtml: false };
  try {
    return { json: JSON.parse(text) as ApiJson, isHtml: false };
  } catch {
    return { json: null, isHtml: false };
  }
}

function describeNonJsonResponse(
  res: Response,
  isHtml: boolean,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (res.status === 504 || res.status === 502) {
    return t("weeklyReport.nonJson.gatewayTimeout");
  }
  if (isHtml) {
    return t("weeklyReport.nonJson.htmlError");
  }
  return t("weeklyReport.nonJson.unhandled", { status: res.status });
}

function GeneratingSpinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`shrink-0 animate-spin text-current ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default function WeeklyReportGenerator() {
  const { t } = useTranslation("pagesStandalone");
  const { token } = useAuth();
  const { lookups: wrCrawlerLookups } = useCrawlerGames(token);
  const wrLabelPc = wrCrawlerLookups.labelByCode["PUBG_PC"] ?? "PUBG_PC";
  const wrLabelMo = wrCrawlerLookups.labelByCode["PUBG_MOBILE"] ?? "PUBG_MOBILE";

  const defaultRange = useMemo(() => getLastWeekRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [platform, setPlatform] = useState<Platform>("pc");
  const [downloading, setDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  
  // PUBG_MOBILE 쪽 VoC 주간 파이프라인 (코드·라벨은 crawler-games에서 관리)
  const [pubgmSources, setPubgmSources] = useState<PubgmSource[]>([]);
  const [pubgmOutputs, setPubgmOutputs] = useState<PubgmOutput[]>([]);
  const [pubgmSourceFile, setPubgmSourceFile] = useState<File | null>(null);
  const [pubgmUseAutoPeriod, setPubgmUseAutoPeriod] = useState(true);
  const [pubgmStartDate, setPubgmStartDate] = useState(defaultRange.start);
  const [pubgmEndDate, setPubgmEndDate] = useState(defaultRange.end);
  const [pubgmLoadingSources, setPubgmLoadingSources] = useState(false);
  const [pubgmLoadingOutputs, setPubgmLoadingOutputs] = useState(false);
  const [pubgmUploading, setPubgmUploading] = useState(false);
  const [pubgmGenerating, setPubgmGenerating] = useState(false);
  const [pubgmGeneratingSourceId, setPubgmGeneratingSourceId] = useState<string | null>(null);
  const [pubgmMessage, setPubgmMessage] = useState<string | null>(null);

  // PUBG_PC 쪽 VoC 주간 파이프라인 (코드·라벨은 crawler-games에서 관리)
  const [pubgpcSources, setPubgpcSources] = useState<PubgmSource[]>([]);
  const [pubgpcOutputs, setPubgpcOutputs] = useState<PubgmOutput[]>([]);
  const [pubgpcSourceFile, setPubgpcSourceFile] = useState<File | null>(null);
  const [pubgpcUseAutoPeriod, setPubgpcUseAutoPeriod] = useState(true);
  const [pubgpcStartDate, setPubgpcStartDate] = useState(defaultRange.start);
  const [pubgpcEndDate, setPubgpcEndDate] = useState(defaultRange.end);
  const [pubgpcLoadingSources, setPubgpcLoadingSources] = useState(false);
  const [pubgpcLoadingOutputs, setPubgpcLoadingOutputs] = useState(false);
  const [pubgpcUploading, setPubgpcUploading] = useState(false);
  const [pubgpcGenerating, setPubgpcGenerating] = useState(false);
  const [pubgpcGeneratingSourceId, setPubgpcGeneratingSourceId] = useState<string | null>(null);
  const [pubgpcMessage, setPubgpcMessage] = useState<string | null>(null);

  const fetchWithTimeout = useCallback((url: string, options: RequestInit = {}, timeoutMs = 15000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
  }, []);

  const fetchPubgmSources = useCallback(async () => {
    setPubgmLoadingSources(true);
    try {
      const res = await fetchWithTimeout("/api/reports/weekly-sources");
      const { json, isHtml } = await readResponseJson(res);
      if (!json || isHtml) {
        console.warn("[PUBGM sources]", describeNonJsonResponse(res, isHtml, t));
        setPubgmSources([]);
      } else if (json.data) setPubgmSources(json.data as PubgmSource[]);
      else setPubgmSources([]);
    } catch (e) {
      setPubgmSources([]);
      if (e instanceof Error && e.name === "AbortError") {
        console.warn("PUBGM sources fetch timeout");
      } else {
        console.warn("PUBGM sources fetch failed", e);
      }
    } finally {
      setPubgmLoadingSources(false);
    }
  }, [fetchWithTimeout]);

  const fetchPubgmOutputs = useCallback(async () => {
    setPubgmLoadingOutputs(true);
    try {
      const res = await fetchWithTimeout("/api/reports/weekly-outputs");
      const { json, isHtml } = await readResponseJson(res);
      if (!json || isHtml) {
        console.warn("[PUBGM outputs]", describeNonJsonResponse(res, isHtml, t));
        setPubgmOutputs([]);
      } else if (json.data) setPubgmOutputs(json.data as PubgmOutput[]);
      else setPubgmOutputs([]);
    } catch (e) {
      setPubgmOutputs([]);
      if (e instanceof Error && e.name === "AbortError") {
        console.warn("PUBGM outputs fetch timeout");
      } else {
        console.warn("PUBGM outputs fetch failed", e);
      }
    } finally {
      setPubgmLoadingOutputs(false);
    }
  }, [fetchWithTimeout]);

  const fetchPubgpcSources = useCallback(async () => {
    setPubgpcLoadingSources(true);
    try {
      const res = await fetchWithTimeout("/api/reports/weekly-pc-sources");
      const { json, isHtml } = await readResponseJson(res);
      if (!json || isHtml) {
        console.warn("[PUBG PC sources]", describeNonJsonResponse(res, isHtml, t));
        setPubgpcSources([]);
      } else if (json.data) setPubgpcSources(json.data as PubgmSource[]);
      else setPubgpcSources([]);
    } catch (e) {
      setPubgpcSources([]);
      if (e instanceof Error && e.name === "AbortError") {
        console.warn("PUBG PC sources fetch timeout");
      } else {
        console.warn("PUBG PC sources fetch failed", e);
      }
    } finally {
      setPubgpcLoadingSources(false);
    }
  }, [fetchWithTimeout]);

  const fetchPubgpcOutputs = useCallback(async () => {
    setPubgpcLoadingOutputs(true);
    try {
      const res = await fetchWithTimeout("/api/reports/weekly-pc-outputs");
      const { json, isHtml } = await readResponseJson(res);
      if (!json || isHtml) {
        console.warn("[PUBG PC outputs]", describeNonJsonResponse(res, isHtml, t));
        setPubgpcOutputs([]);
      } else if (json.data) setPubgpcOutputs(json.data as PubgmOutput[]);
      else setPubgpcOutputs([]);
    } catch (e) {
      setPubgpcOutputs([]);
      if (e instanceof Error && e.name === "AbortError") {
        console.warn("PUBG PC outputs fetch timeout");
      } else {
        console.warn("PUBG PC outputs fetch failed", e);
      }
    } finally {
      setPubgpcLoadingOutputs(false);
    }
  }, [fetchWithTimeout]);

  useEffect(() => {
    fetchPubgmSources();
    fetchPubgmOutputs();
  }, [fetchPubgmSources, fetchPubgmOutputs]);

  useEffect(() => {
    fetchPubgpcSources();
    fetchPubgpcOutputs();
  }, [fetchPubgpcSources, fetchPubgpcOutputs]);

  const applyRange = (range: { start: string; end: string }) => {
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const handleDownload = async () => {
    if (!startDate || !endDate) {
      alert(t("weeklyReport.errors.needPeriod"));
      return;
    }

    setDownloading(true);
    setStatusMessage(null);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        platform
      });
      const res = await fetch(`/api/reports/weekly/download?${params.toString()}`);
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        const msg =
          isHtml || !json
            ? describeNonJsonResponse(res, isHtml, t)
            : String(json.error || json.message || t("weeklyReport.errors.downloadFailed"));
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `weekly_report_${platform}_${startDate}_${endDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatusMessage(t("weeklyReport.alerts.downloaded"));
    } catch (error: any) {
      console.error(error);
      alert(error.message || t("weeklyReport.errors.downloadError"));
    } finally {
      setDownloading(false);
    }
  };

  const handlePubgmUploadSource = async () => {
    if (!pubgmSourceFile) {
      alert(t("weeklyReport.errors.needFile"));
      return;
    }
    setPubgmUploading(true);
    setPubgmMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", pubgmSourceFile);
      const res = await fetchWithTimeout("/api/reports/weekly-sources/upload", { method: "POST", body: formData }, 60000);
      const { json, isHtml } = await readResponseJson(res);
      if (isHtml || !json) throw new Error(describeNonJsonResponse(res, isHtml, t));
      if (!res.ok) throw new Error(String(json.error || json.message || t("weeklyReport.errors.uploadFailed")));
      setPubgmMessage(t("weeklyReport.alerts.sourceUploaded"));
      setPubgmSourceFile(null);
      await fetchPubgmSources();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("weeklyReport.errors.uploadError");
      if (e instanceof Error && e.name === "AbortError") {
        alert(t("weeklyReport.errors.timeout"));
      } else if (msg === "Failed to fetch" || (e instanceof Error && e.message?.includes("fetch"))) {
        alert(t("weeklyReport.errors.backendUnreachable"));
      } else {
        alert(msg);
      }
    } finally {
      setPubgmUploading(false);
    }
  };

  const handlePubgmDeleteSource = async (sourceId: string) => {
    if (!confirm(t("weeklyReport.errors.confirmDeleteSource"))) return;
    try {
      const res = await fetch(`/api/reports/weekly-sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        if (isHtml || !json) throw new Error(describeNonJsonResponse(res, isHtml, t));
        throw new Error(String(json.error || json.message || t("weeklyReport.errors.deleteFailed")));
      }
      await fetchPubgmSources();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t("weeklyReport.errors.deleteFailed"));
    }
  };

  const handlePubgmGenerate = async (sourceId: string) => {
    if (pubgmGenerating) return;
    if (!pubgmUseAutoPeriod && (pubgmStartDate > pubgmEndDate || !pubgmStartDate || !pubgmEndDate)) {
      alert(t("weeklyReport.errors.invalidRange"));
      return;
    }
    setPubgmGenerating(true);
    setPubgmGeneratingSourceId(sourceId);
    setPubgmMessage(null);
    try {
      const body: { sourceId: string; useAutoPeriod?: number; startDate?: string; endDate?: string } = { sourceId };
      if (pubgmUseAutoPeriod) {
        body.useAutoPeriod = 1;
      } else {
        body.startDate = pubgmStartDate;
        body.endDate = pubgmEndDate;
      }
      const res = await fetchWithTimeout(
        "/api/reports/weekly-sources/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        600000
      );
      const { json, isHtml } = await readResponseJson(res);
      if (isHtml || !json) {
        throw new Error(describeNonJsonResponse(res, isHtml, t));
      }
      const data = json as { error?: string; message?: string; data?: { message?: string } };
      if (!res.ok) throw new Error(data?.error || data?.message || t("weeklyReport.errors.generateFailed"));
      setPubgmMessage(data?.data?.message || t("weeklyReport.errors.generated"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("weeklyReport.errors.generateFailed");
      if (e instanceof Error && e.name === "AbortError") {
        alert(t("weeklyReport.errors.timeout"));
      } else if (msg === "Failed to fetch" || (e instanceof Error && e.message?.includes("fetch"))) {
        alert(t("weeklyReport.errors.backendUnreachable"));
      } else {
        alert(msg);
      }
    } finally {
      setPubgmGenerating(false);
      setPubgmGeneratingSourceId(null);
      void fetchPubgmOutputs();
    }
  };

  const handlePubgmDownload = async (jobId: string, file: string) => {
    const url = `/api/reports/weekly-outputs/download?job=${encodeURIComponent(jobId)}&file=${encodeURIComponent(file)}&platform=mobile`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        const msg =
          isHtml || !json
            ? describeNonJsonResponse(res, isHtml, t)
            : String(
                json.message ||
                  json.error ||
                  (res.status === 404 ? t("weeklyReport.errors.outputNotFound") : t("weeklyReport.errors.downloadFailed"))
              );
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = file;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(href);
    } catch (e) {
      alert(e instanceof Error ? e.message : t("weeklyReport.errors.downloadFailed"));
    }
  };

  const handlePubgmDeleteOutput = async (jobId: string) => {
    if (!confirm(t("weeklyReport.errors.confirmDeleteSource"))) return;
    try {
      const res = await fetch(`/api/reports/weekly-outputs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        if (isHtml || !json) throw new Error(describeNonJsonResponse(res, isHtml, t));
        throw new Error(String(json.error || json.message || t("weeklyReport.errors.deleteFailed")));
      }
      await fetchPubgmOutputs();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t("weeklyReport.errors.deleteFailed"));
    }
  };

  const pubgmPeriodValid = pubgmUseAutoPeriod || (pubgmStartDate && pubgmEndDate && pubgmStartDate <= pubgmEndDate);

  const handlePubgpcUploadSource = async () => {
    if (!pubgpcSourceFile) {
      alert(t("weeklyReport.errors.needFile"));
      return;
    }
    setPubgpcUploading(true);
    setPubgpcMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", pubgpcSourceFile);
      const res = await fetchWithTimeout("/api/reports/weekly-pc-sources/upload", { method: "POST", body: formData }, 60000);
      const { json, isHtml } = await readResponseJson(res);
      if (isHtml || !json) throw new Error(describeNonJsonResponse(res, isHtml, t));
      if (!res.ok) throw new Error(String(json.error || json.message || t("weeklyReport.errors.uploadFailed")));
      setPubgpcMessage(t("weeklyReport.alerts.sourceUploaded"));
      setPubgpcSourceFile(null);
      await fetchPubgpcSources();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("weeklyReport.errors.uploadError");
      if (e instanceof Error && e.name === "AbortError") {
        alert(t("weeklyReport.errors.timeout"));
      } else if (msg === "Failed to fetch" || (e instanceof Error && e.message?.includes("fetch"))) {
        alert(t("weeklyReport.errors.backendUnreachable"));
      } else {
        alert(msg);
      }
    } finally {
      setPubgpcUploading(false);
    }
  };

  const handlePubgpcDeleteSource = async (sourceId: string) => {
    if (!confirm(t("weeklyReport.errors.confirmDeleteSource"))) return;
    try {
      const res = await fetch(`/api/reports/weekly-pc-sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        if (isHtml || !json) throw new Error(describeNonJsonResponse(res, isHtml, t));
        throw new Error(String(json.error || json.message || t("weeklyReport.errors.deleteFailed")));
      }
      await fetchPubgpcSources();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t("weeklyReport.errors.deleteFailed"));
    }
  };

  const handlePubgpcGenerate = async (sourceId: string) => {
    if (pubgpcGenerating) return;
    if (!pubgpcUseAutoPeriod && (pubgpcStartDate > pubgpcEndDate || !pubgpcStartDate || !pubgpcEndDate)) {
      alert(t("weeklyReport.errors.invalidRange"));
      return;
    }
    setPubgpcGenerating(true);
    setPubgpcGeneratingSourceId(sourceId);
    setPubgpcMessage(null);
    try {
      const body: { sourceId: string; periodMode: "auto" | "custom"; startDate?: string; endDate?: string } = {
        sourceId,
        periodMode: pubgpcUseAutoPeriod ? "auto" : "custom"
      };
      if (!pubgpcUseAutoPeriod) {
        body.startDate = pubgpcStartDate;
        body.endDate = pubgpcEndDate;
      }
      const res = await fetchWithTimeout(
        "/api/reports/weekly-pc-sources/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        600000
      );
      const { json, isHtml } = await readResponseJson(res);
      if (isHtml || !json) {
        throw new Error(describeNonJsonResponse(res, isHtml, t));
      }
      const data = json as { error?: string; message?: string; data?: { message?: string } };
      if (!res.ok) throw new Error(data?.error || data?.message || t("weeklyReport.errors.generateFailed"));
      setPubgpcMessage(data?.data?.message || t("weeklyReport.errors.generated"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("weeklyReport.errors.generateFailed");
      if (e instanceof Error && e.name === "AbortError") {
        alert(t("weeklyReport.errors.timeout"));
      } else if (msg === "Failed to fetch" || (e instanceof Error && e.message?.includes("fetch"))) {
        alert(t("weeklyReport.errors.backendUnreachable"));
      } else {
        alert(msg);
      }
    } finally {
      setPubgpcGenerating(false);
      setPubgpcGeneratingSourceId(null);
      void fetchPubgpcOutputs();
    }
  };

  const handlePubgpcDownload = async (jobId: string, file: string) => {
    const url = `/api/reports/weekly-pc-outputs/download?jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(file)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        const msg =
          isHtml || !json
            ? describeNonJsonResponse(res, isHtml, t)
            : String(
                json.message ||
                  json.error ||
                  (res.status === 404 ? t("weeklyReport.errors.outputNotFound") : t("weeklyReport.errors.downloadFailed"))
              );
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = file;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(href);
    } catch (e) {
      alert(e instanceof Error ? e.message : t("weeklyReport.errors.downloadFailed"));
    }
  };

  const handlePubgpcDeleteOutput = async (jobId: string) => {
    if (!confirm(t("weeklyReport.errors.confirmDeleteSource"))) return;
    try {
      const res = await fetch(`/api/reports/weekly-pc-outputs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
      if (!res.ok) {
        const { json, isHtml } = await readResponseJson(res);
        if (isHtml || !json) throw new Error(describeNonJsonResponse(res, isHtml, t));
        throw new Error(String(json.error || json.message || t("weeklyReport.errors.deleteFailed")));
      }
      await fetchPubgpcOutputs();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t("weeklyReport.errors.deleteFailed"));
    }
  };

  const pubgpcPeriodValid = pubgpcUseAutoPeriod || (pubgpcStartDate && pubgpcEndDate && pubgpcStartDate <= pubgpcEndDate);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{t("weeklyReport.ui.summaryHeading")}</h1>
            <p className="text-sm text-slate-500 mt-1">{t("weeklyReport.ui.summarySubtitle")}</p>
          </div>
          <a href="/" className="ui-btn ui-btn-outline ui-btn-sm">
            {t("weeklyReport.ui.backToDashboard")}
          </a>
        </div>

        <div className="ui-card ui-card-pad space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">{t("weeklyReport.ui.step1Title")}</h2>
            <p className="text-sm text-slate-500 mb-3">{t("weeklyReport.ui.step1Hint")}</p>
            <div className="inline-flex rounded-xl border bg-slate-100 p-1 text-sm font-medium">
              {(["pc", "mobile"] as Platform[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setPlatform(item)}
                  className={cn(
                    "ui-btn ui-btn-sm bg-transparent shadow-none hover:bg-white/70",
                    platform === item ? "bg-white shadow-soft text-slate-900" : "text-slate-500"
                  )}
                >
                  {item === "pc" ? wrLabelPc : wrLabelMo}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">{t("weeklyReport.ui.step2Title")}</h2>
            <p className="text-sm text-slate-500 mb-3">{t("weeklyReport.ui.weekAutoHint")}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t("weeklyReport.ui.startDate")}</label>
                <LocalizedDateInput
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t("weeklyReport.ui.endDate")}</label>
                <LocalizedDateInput
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button onClick={() => applyRange(getLastWeekRange())} variant="outline" size="sm" className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100">
                {t("weeklyReport.ui.applyLastWeek")}
              </Button>
              <Button onClick={() => applyRange(getWeekRange(new Date()))} variant="outline" size="sm" className="bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100">
                {t("weeklyReport.ui.applyThisWeek")}
              </Button>
              <Button
                onClick={() => {
                  if (!startDate) {
                    alert(t("weeklyReport.ui.selectStartFirst"));
                    return;
                  }
                  applyRange(getWeekRange(new Date(startDate)));
                }}
                variant="outline"
                size="sm"
              >
                {t("weeklyReport.ui.applyWeekContaining")}
              </Button>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">{t("weeklyReport.ui.step3Title")}</h2>
            <p className="text-sm text-slate-500 mb-4">{t("weeklyReport.ui.step3Hint")}</p>
            <Button onClick={handleDownload} disabled={downloading} variant="primary" size="lg" className="w-full md:w-auto">
              {downloading ? t("weeklyReport.ui.preparingDownload") : t("weeklyReport.ui.downloadSummary")}
            </Button>
            {statusMessage && (
              <p className="mt-3 text-sm text-green-600">{statusMessage}</p>
            )}
          </div>
        </div>

        {/* PUBG_MOBILE VoC 주간보고서 카드 */}
        <div className="ui-card ui-card-pad space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {t("weeklyReport.ui.vocCardTitle", { label: wrLabelMo })}
            </h2>
            <p className="text-sm text-slate-500 mt-1">{t("weeklyReport.ui.vocCardSubtitle")}</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{t("weeklyReport.ui.vocStep1Title")}</h3>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setPubgmSourceFile(e.target.files?.[0] || null)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
              <Button
                type="button"
                onClick={handlePubgmUploadSource}
                disabled={pubgmUploading || !pubgmSourceFile}
                variant="outline"
                className="bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
              >
                {pubgmUploading ? t("weeklyReport.ui.uploading") : t("weeklyReport.ui.upload")}
              </Button>
              <Button type="button" onClick={fetchPubgmSources} disabled={pubgmLoadingSources} variant="outline">
                {t("weeklyReport.ui.refreshList")}
              </Button>
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 min-h-[60px]">
              {pubgmLoadingSources ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.loadingList")}</p>
              ) : pubgmSources.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.emptySources")}</p>
              ) : (
                pubgmSources.map((s) => (
                  <div key={s.sourceId} className="flex items-center justify-between p-3 text-sm">
                    <span className="text-slate-700">
                      {s.name} · {(s.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handlePubgmGenerate(s.sourceId)}
                        disabled={!pubgmPeriodValid || pubgmGenerating}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-xs font-medium min-w-[9.5rem]"
                      >
                        {pubgmGenerating && pubgmGeneratingSourceId === s.sourceId ? (
                          <>
                            <GeneratingSpinner className="h-3.5 w-3.5" />
                            {t("weeklyReport.ui.generating")}
                          </>
                        ) : (
                          t("weeklyReport.ui.generate")
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePubgmDeleteSource(s.sourceId)}
                        className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-xs font-medium"
                      >
                        {t("weeklyReport.ui.delete")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{t("weeklyReport.ui.vocStep2Title")}</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pubgmPeriod"
                  checked={pubgmUseAutoPeriod}
                  onChange={() => setPubgmUseAutoPeriod(true)}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{t("weeklyReport.ui.periodAuto")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pubgmPeriod"
                  checked={!pubgmUseAutoPeriod}
                  onChange={() => setPubgmUseAutoPeriod(false)}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{t("weeklyReport.ui.periodCustom")}</span>
              </label>
              {!pubgmUseAutoPeriod && (
                <div className="flex gap-3 items-center">
                  <LocalizedDateInput
                    type="date"
                    value={pubgmStartDate}
                    onChange={(e) => setPubgmStartDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <span className="text-slate-500">~</span>
                  <LocalizedDateInput
                    type="date"
                    value={pubgmEndDate}
                    onChange={(e) => setPubgmEndDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{t("weeklyReport.ui.vocStep3Title")}</h3>
            {pubgmGenerating && (
              <div
                role="status"
                aria-live="polite"
                className="mb-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                <GeneratingSpinner className="h-5 w-5 text-amber-700 mt-0.5" />
                <div>
                  <p className="font-medium">{t("weeklyReport.ui.generatingBannerTitle")}</p>
                  <p className="mt-1 text-amber-900/90 leading-relaxed">{t("weeklyReport.ui.generatingBannerBody")}</p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              <Button type="button" onClick={fetchPubgmOutputs} disabled={pubgmLoadingOutputs} variant="outline">
                {t("weeklyReport.ui.refreshOutputs")}
              </Button>
            </div>
            {pubgmMessage && <p className="text-sm text-green-600 mb-2">{pubgmMessage}</p>}
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 min-h-[60px]">
              {pubgmLoadingOutputs ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.loadingList")}</p>
              ) : pubgmGenerating && pubgmOutputs.length === 0 ? (
                <div className="p-4 flex items-center gap-2 text-sm text-slate-600">
                  <GeneratingSpinner className="h-4 w-4 text-blue-600" />
                  {t("weeklyReport.ui.outputReadyHint")}
                </div>
              ) : pubgmOutputs.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.emptyOutputs")}</p>
              ) : (
                pubgmOutputs.map((o) => (
                  <div key={o.jobId} className="flex items-center justify-between p-3 text-sm">
                    <span className="text-slate-700">
                      {o.file}
                      {o.periodStart && o.periodEnd && (
                        <span className="text-slate-500 ml-2">
                          ({o.periodStart} ~ {o.periodEnd})
                        </span>
                      )}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handlePubgmDownload(o.jobId, o.file)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-medium"
                      >
                        {t("weeklyReport.ui.download")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePubgmDeleteOutput(o.jobId)}
                        className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-xs font-medium"
                      >
                        {t("weeklyReport.ui.delete")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* PUBG_PC VoC 주간보고서 카드 */}
        <div className="ui-card ui-card-pad space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {t("weeklyReport.ui.vocCardTitle", { label: wrLabelPc })}
            </h2>
            <p className="text-sm text-slate-500 mt-1">{t("weeklyReport.ui.vocCardSubtitle")}</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{t("weeklyReport.ui.vocStep1Title")}</h3>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setPubgpcSourceFile(e.target.files?.[0] || null)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
              <Button
                type="button"
                onClick={handlePubgpcUploadSource}
                disabled={pubgpcUploading || !pubgpcSourceFile}
                variant="outline"
                className="bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
              >
                {pubgpcUploading ? t("weeklyReport.ui.uploading") : t("weeklyReport.ui.upload")}
              </Button>
              <Button type="button" onClick={fetchPubgpcSources} disabled={pubgpcLoadingSources} variant="outline">
                {t("weeklyReport.ui.refreshList")}
              </Button>
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 min-h-[60px]">
              {pubgpcLoadingSources ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.loadingList")}</p>
              ) : pubgpcSources.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.emptySources")}</p>
              ) : (
                pubgpcSources.map((s) => (
                  <div key={s.sourceId} className="flex items-center justify-between p-3 text-sm">
                    <span className="text-slate-700">
                      {s.name} · {(s.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handlePubgpcGenerate(s.sourceId)}
                        disabled={!pubgpcPeriodValid || pubgpcGenerating}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-xs font-medium min-w-[9.5rem]"
                      >
                        {pubgpcGenerating && pubgpcGeneratingSourceId === s.sourceId ? (
                          <>
                            <GeneratingSpinner className="h-3.5 w-3.5" />
                            {t("weeklyReport.ui.generating")}
                          </>
                        ) : (
                          t("weeklyReport.ui.generate")
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePubgpcDeleteSource(s.sourceId)}
                        className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-xs font-medium"
                      >
                        {t("weeklyReport.ui.delete")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{t("weeklyReport.ui.vocStep2Title")}</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pubgpcPeriod"
                  checked={pubgpcUseAutoPeriod}
                  onChange={() => setPubgpcUseAutoPeriod(true)}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{t("weeklyReport.ui.periodAuto")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pubgpcPeriod"
                  checked={!pubgpcUseAutoPeriod}
                  onChange={() => setPubgpcUseAutoPeriod(false)}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{t("weeklyReport.ui.periodCustom")}</span>
              </label>
              {!pubgpcUseAutoPeriod && (
                <div className="flex gap-3 items-center">
                  <LocalizedDateInput
                    type="date"
                    value={pubgpcStartDate}
                    onChange={(e) => setPubgpcStartDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <span className="text-slate-500">~</span>
                  <LocalizedDateInput
                    type="date"
                    value={pubgpcEndDate}
                    onChange={(e) => setPubgpcEndDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{t("weeklyReport.ui.vocStep3Title")}</h3>
            {pubgpcGenerating && (
              <div
                role="status"
                aria-live="polite"
                className="mb-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                <GeneratingSpinner className="h-5 w-5 text-amber-700 mt-0.5" />
                <div>
                  <p className="font-medium">{t("weeklyReport.ui.generatingBannerTitle")}</p>
                  <p className="mt-1 text-amber-900/90 leading-relaxed">{t("weeklyReport.ui.generatingBannerBody")}</p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              <Button type="button" onClick={fetchPubgpcOutputs} disabled={pubgpcLoadingOutputs} variant="outline">
                {t("weeklyReport.ui.refreshOutputs")}
              </Button>
            </div>
            {pubgpcMessage && <p className="text-sm text-green-600 mb-2">{pubgpcMessage}</p>}
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 min-h-[60px]">
              {pubgpcLoadingOutputs ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.loadingList")}</p>
              ) : pubgpcGenerating && pubgpcOutputs.length === 0 ? (
                <div className="p-4 flex items-center gap-2 text-sm text-slate-600">
                  <GeneratingSpinner className="h-4 w-4 text-blue-600" />
                  {t("weeklyReport.ui.outputReadyHint")}
                </div>
              ) : pubgpcOutputs.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">{t("weeklyReport.ui.emptyOutputs")}</p>
              ) : (
                pubgpcOutputs.map((o) => (
                  <div key={o.jobId} className="flex items-center justify-between p-3 text-sm">
                    <span className="text-slate-700">
                      {o.file}
                      {o.periodStart && o.periodEnd && (
                        <span className="text-slate-500 ml-2">
                          ({o.periodStart} ~ {o.periodEnd})
                        </span>
                      )}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handlePubgpcDownload(o.jobId, o.file)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-medium"
                      >
                        {t("weeklyReport.ui.download")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePubgpcDeleteOutput(o.jobId)}
                        className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-xs font-medium"
                      >
                        {t("weeklyReport.ui.delete")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="ui-card ui-card-pad">
          <h3 className="text-lg font-semibold text-slate-800 mb-3">{t("weeklyReport.ui.guideTitle")}</h3>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            <li>{t("weeklyReport.ui.guide.li1")}</li>
            <li>{t("weeklyReport.ui.guide.li2")}</li>
            <li>{t("weeklyReport.ui.guide.li3")}</li>
            <li>{t("weeklyReport.ui.guide.li4")}</li>
            <li>{t("weeklyReport.ui.guide.li5")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}















