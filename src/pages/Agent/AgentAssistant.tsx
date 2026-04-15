import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import ChatBot from "../../components/ChatBot";

interface WorkGuide {
  id: string;
  title: string;
  content: string;
  guideType: string;
  categoryGroupId?: number;
  categoryId?: number;
  priority: number;
  tags: string[];
  metadata?: {
    filePath?: string;
    fileName?: string;
    [key: string]: any;
  } | null;
}

export default function AgentAssistant() {
  const { t } = useTranslation("pagesAgent");
  const { token } = useAuth();
  const [guides, setGuides] = useState<WorkGuide[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<WorkGuide | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  useEffect(() => {
    loadGuides();
  }, []);

  const loadGuides = async () => {
    setLoading(true);
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch("/api/work-guides", { headers });
      if (response.ok) {
        const data = await response.json();
        // metadata 파싱 (JSON 문자열인 경우)
        const guides = (data.data || []).map((g: any) => ({
          ...g,
          tags: g.tags ? (typeof g.tags === 'string' ? JSON.parse(g.tags) : g.tags) : [],
          metadata: g.metadata ? (typeof g.metadata === 'string' ? JSON.parse(g.metadata) : g.metadata) : {}
        }));
        setGuides(guides);
      }
    } catch (error) {
      console.error("Failed to load guides:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleGuideSelect = async (guideId: string) => {
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch(`/api/work-guides/${guideId}`, { headers });
      if (response.ok) {
        const data = await response.json();
        // metadata 파싱 (JSON 문자열인 경우)
        const guide = data.data;
        if (guide.metadata && typeof guide.metadata === 'string') {
          guide.metadata = JSON.parse(guide.metadata);
        }
        if (guide.tags && typeof guide.tags === 'string') {
          guide.tags = JSON.parse(guide.tags);
        }
        setSelectedGuide(guide);
      }
    } catch (error) {
      console.error("Failed to load guide:", error);
    }
  };

  const filteredGuides = guides.filter((guide) => {
    const matchesSearch = searchQuery === "" || 
      guide.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guide.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || guide.guideType === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <div className="relative mb-8 overflow-hidden rounded-2xl border-2 border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-6 shadow-xl shadow-violet-500/10 dark:border-violet-800/80 dark:from-violet-950/40 dark:via-slate-900 dark:to-indigo-950/30 md:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-500/15" />
        <div className="pointer-events-none absolute -bottom-12 -left-8 h-40 w-40 rounded-full bg-sky-400/15 blur-3xl dark:bg-sky-500/10" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-2xl text-white shadow-lg shadow-violet-600/40">
              ✨
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                {t("assistant.heroKicker")}
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white md:text-3xl">
                {t("assistant.title")}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {t("assistant.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-violet-800 shadow-sm ring-1 ring-violet-200 dark:bg-violet-950/80 dark:text-violet-200 dark:ring-violet-700">
              {t("assistant.badgeChat")}
            </span>
            <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-indigo-800 shadow-sm ring-1 ring-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-200 dark:ring-indigo-700">
              {t("assistant.badgeSources")}
            </span>
          </div>
        </div>
      </div>

      <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 챗봇 영역 */}
        <div className="overflow-hidden rounded-2xl border-2 border-violet-200/70 bg-white shadow-2xl shadow-violet-500/15 ring-1 ring-violet-500/10 dark:border-violet-800/60 dark:bg-slate-900 dark:shadow-violet-900/20 lg:col-span-2">
          <div className="h-full min-h-[320px]">
            <ChatBot
              token={token}
              onGuideSelect={handleGuideSelect}
              className="h-full"
            />
          </div>
        </div>

        {/* 가이드 목록 영역 */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-4 dark:border-violet-900/40 dark:from-violet-950/50 dark:to-indigo-950/40">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("assistant.panelTitle")}</h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{t("assistant.panelHint")}</p>

            {/* 검색 및 필터 */}
            <div className="mt-3 space-y-2">
              <input
                type="text"
                placeholder={t("assistant.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-violet-200/80 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full rounded-xl border border-violet-200/80 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">{t("assistant.filterAll")}</option>
                <option value="classification">{t("assistant.filterClassification")}</option>
                <option value="handling">{t("assistant.filterHandling")}</option>
                <option value="escalation">{t("assistant.filterEscalation")}</option>
                <option value="general">{t("assistant.filterGeneral")}</option>
                <option value="faq">{t("assistant.filterFaq")}</option>
              </select>
            </div>
          </div>

          {/* 가이드 목록 */}
          <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 dark:bg-slate-950/30">
            {loading ? (
              <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                {t("assistant.loading")}
              </div>
            ) : filteredGuides.length === 0 ? (
              <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                {t("assistant.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGuides
                  .sort((a, b) => b.priority - a.priority)
                  .map((guide) => (
                    <div
                      key={guide.id}
                      onClick={() => setSelectedGuide(guide)}
                      className={`cursor-pointer rounded-xl border-2 p-3 transition-all ${
                        selectedGuide?.id === guide.id
                          ? "border-violet-500 bg-violet-50 shadow-md dark:border-violet-400 dark:bg-violet-950/50"
                          : "border-slate-200/90 bg-white hover:border-violet-300 hover:shadow-md dark:border-slate-600 dark:bg-slate-800 dark:hover:border-violet-700"
                      }`}
                    >
                      <div className="font-medium text-slate-800 dark:text-slate-200 text-sm">
                        {guide.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {guide.guideType} • {t("assistant.priority", { n: guide.priority })}
                      </div>
                      {guide.tags && guide.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {guide.tags.slice(0, 3).map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-xs px-2 py-0.5 bg-slate-200 dark:bg-slate-600 rounded text-slate-600 dark:text-slate-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 가이드 상세 모달 */}
      {selectedGuide && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedGuide(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                  {selectedGuide.title}
                </h2>
                <div className="flex gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <span>
                    {t("assistant.typeLabel")} {selectedGuide.guideType}
                  </span>
                  <span>•</span>
                  <span>{t("assistant.priority", { n: selectedGuide.priority })}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedGuide(null)}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {selectedGuide.content}
              </div>
              
              {/* 원본 파일 링크 (이미지 포함된 파일 확인용) */}
              {(selectedGuide as any).metadata?.filePath && (
                <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                    {t("assistant.modalOriginalFile")}
                  </div>
                  <a
                    href={`/api/work-guides/${selectedGuide.id}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm font-medium"
                  >
                    <span>📄</span>
                    <span>{t("assistant.openOriginalFile")}</span>
                  </a>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    {t("assistant.originalFileHint")}
                  </p>
                </div>
              )}
              
              {selectedGuide.tags && selectedGuide.tags.length > 0 && (
                <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                    {t("assistant.tags")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedGuide.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
