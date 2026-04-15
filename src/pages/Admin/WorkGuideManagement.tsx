import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { agentManualBasePath } from "../../utils/agentManual";

interface WorkGuide {
  id: string;
  title: string;
  content: string;
  guideType: string;
  category?: string | null;
  tags?: string | string[] | null;
  sourceUrl?: string | null;
  metadata?: {
    fileName?: string;
    filePath?: string;
    fileType?: string;
    fileSize?: number;
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

const GUIDE_TYPE_VALUES = [
  "general",
  "classification",
  "handling",
  "escalation",
  "faq",
  "troubleshooting",
] as const;

export default function WorkGuideManagement() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token, user } = useAuth();
  const [guides, setGuides] = useState<WorkGuide[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingGuide, setEditingGuide] = useState<WorkGuide | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    guideType: "general",
    category: "",
    tags: "",
    sourceUrl: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    total: number;
    success: number;
    failed: number;
    errors: Array<{ file: string; error: string }>;
    filesTotal?: number;
    filesProcessed?: number;
  } | null>(null);

  const dateLocale = i18n.language?.toLowerCase().startsWith("ko") ? "ko-KR" : "en-US";

  const guideTypeLabel = (value: string) =>
    t(`admin.workGuide.guideTypes.${value}`, { defaultValue: value });

  useEffect(() => {
    if (token && (user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN")) {
      loadGuides();
    }
  }, [token, user]);

  const loadGuides = async () => {
    setLoading(true);
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch("/api/work-guides", { headers });
      if (response.ok) {
        const data = await response.json();
        const guidesWithParsedTags = (data.data || []).map((guide: any) => ({
          ...guide,
          tags: guide.tags ? (typeof guide.tags === "string" ? JSON.parse(guide.tags) : guide.tags) : [],
          metadata: guide.metadata
            ? typeof guide.metadata === "string"
              ? JSON.parse(guide.metadata)
              : guide.metadata
            : {},
        }));
        setGuides(guidesWithParsedTags);
      } else {
        console.error("Failed to load guides");
      }
    } catch (error) {
      console.error("Failed to load guides:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingGuide(null);
    setFormData({
      title: "",
      content: "",
      guideType: "general",
      category: "",
      tags: "",
      sourceUrl: "",
    });
    setShowForm(true);
  };

  const handleEdit = (guide: WorkGuide) => {
    setEditingGuide(guide);
    setFormData({
      title: guide.title,
      content: guide.content,
      guideType: guide.guideType,
      category: guide.category || "",
      tags: Array.isArray(guide.tags) ? guide.tags.join(", ") : guide.tags || "",
      sourceUrl: guide.sourceUrl || "",
    });
    setShowForm(true);
  };

  const handleDelete = async (guideId: string) => {
    if (!confirm(t("admin.workGuide.confirmDelete"))) return;

    setDeleting(guideId);
    try {
      const headers = createAuthHeaders(token);
      const response = await fetch(`/api/work-guides/${guideId}`, {
        method: "DELETE",
        headers,
      });

      if (response.ok) {
        await loadGuides();
      } else {
        const error = await response.json();
        alert(error.error || t("admin.workGuide.deleteFailed"));
      }
    } catch (error) {
      console.error("Failed to delete guide:", error);
      alert(t("admin.workGuide.deleteError"));
    } finally {
      setDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.content.trim()) {
      alert(t("admin.workGuide.needTitleContent"));
      return;
    }

    setSubmitting(true);
    try {
      const headers = createAuthHeaders(token);
      const url = editingGuide ? `/api/work-guides/${editingGuide.id}` : "/api/work-guides";
      const method = editingGuide ? "PATCH" : "POST";

      const payload: any = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        guideType: formData.guideType,
        category: formData.category.trim() || null,
        tags: formData.tags.trim() || null,
        sourceUrl: formData.sourceUrl.trim() || null,
      };

      const response = await fetch(url, {
        method,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        await loadGuides();
        setShowForm(false);
        setEditingGuide(null);
        setFormData({
          title: "",
          content: "",
          guideType: "general",
          category: "",
          tags: "",
          sourceUrl: "",
        });
      } else {
        const error = await response.json();
        alert(error.error || t("admin.workGuide.saveFailed"));
      }
    } catch (error) {
      console.error("Failed to save guide:", error);
      alert(t("admin.workGuide.saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  const filteredGuides = guides.filter((guide) => {
    const matchesSearch =
      searchQuery === "" ||
      guide.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guide.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (guide.category && guide.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (guide.tags &&
        (Array.isArray(guide.tags)
          ? guide.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
          : guide.tags.toLowerCase().includes(searchQuery.toLowerCase())));
    const matchesType = filterType === "all" || guide.guideType === filterType;
    return matchesSearch && matchesType;
  });

  const filterLabelForHint = useMemo(() => {
    if (filterType === "all") return t("admin.workGuide.filterAll");
    return guideTypeLabel(filterType);
  }, [filterType, t, i18n.language]);

  if (!token || (user?.role !== "ADMIN" && user?.role !== "LEAD" && user?.role !== "SUPERADMIN")) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-yellow-800 dark:text-yellow-200">{t("admin.workGuide.needAdmin")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t("admin.workGuide.title")}</h1>
          <p className="text-slate-600 dark:text-slate-400">{t("admin.workGuide.subtitle")}</p>
        </div>
        <a
          href={`${agentManualBasePath(i18n)}#guide-management`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
        >
          📖 {t("admin.workGuide.manualLink")}
        </a>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border dark:border-slate-700 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t("admin.workGuide.search")}
            </label>
            <input
              type="text"
              placeholder={t("admin.workGuide.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t("admin.workGuide.typeFilter")}
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
            >
              <option value="all">{t("admin.workGuide.filterAll")}</option>
              {GUIDE_TYPE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {guideTypeLabel(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {guides.length > 0 && filteredGuides.length !== guides.length
              ? t("admin.workGuide.listTitleBoth", {
                  filtered: filteredGuides.length,
                  total: guides.length,
                })
              : t("admin.workGuide.listTitleOne", { filtered: filteredGuides.length })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
            >
              <span>📁</span>
              <span>{t("admin.workGuide.fileUpload")}</span>
            </button>
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
            >
              <span>➕</span>
              <span>{t("admin.workGuide.newGuide")}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">{t("admin.workGuide.loading")}</div>
        ) : (
          <>
            {filteredGuides.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                {guides.length === 0 ? (
                  t("admin.workGuide.emptyNoGuides")
                ) : (
                  <div>
                    <p className="mb-2">{t("admin.workGuide.emptyNoResults")}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                      {t("admin.workGuide.searchHint", { query: searchQuery, filter: filterLabelForHint })}
                    </p>
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setFilterType("all");
                      }}
                      className="px-4 py-2 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                    >
                      {t("admin.workGuide.resetFilter")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredGuides.map((guide) => (
                  <div
                    key={guide.id}
                    className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{guide.title}</h3>
                          <span className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                            {guideTypeLabel(guide.guideType)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">{guide.content}</p>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                          {guide.category && (
                            <span>
                              {t("admin.workGuide.category")} {guide.category}
                            </span>
                          )}
                          {guide.tags && Array.isArray(guide.tags) && guide.tags.length > 0 && (
                            <span>
                              {t("admin.workGuide.tags")} {guide.tags.join(", ")}
                            </span>
                          )}
                          {guide.tags && typeof guide.tags === "string" && guide.tags.trim() && (
                            <span>
                              {t("admin.workGuide.tags")} {guide.tags}
                            </span>
                          )}
                          <span>
                            {t("admin.workGuide.created")}{" "}
                            {new Date(guide.createdAt).toLocaleDateString(dateLocale)}
                          </span>
                          {guide.updatedAt !== guide.createdAt && (
                            <span>
                              {t("admin.workGuide.updated")}{" "}
                              {new Date(guide.updatedAt).toLocaleDateString(dateLocale)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        {guide.metadata?.filePath && (
                          <button
                            onClick={() => {
                              const url = `/api/work-guides/${guide.id}/file`;
                              window.open(url, "_blank");
                            }}
                            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center gap-1"
                            title={t("admin.workGuide.openFileTitle", {
                              name: guide.metadata?.fileName || t("admin.workGuide.fileFallback"),
                            })}
                          >
                            <span>📄</span>
                            <span>{t("admin.workGuide.viewFile")}</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(guide)}
                          className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-500 transition-colors"
                        >
                          {t("admin.workGuide.edit")}
                        </button>
                        <button
                          onClick={() => handleDelete(guide.id)}
                          disabled={deleting === guide.id}
                          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {deleting === guide.id ? t("admin.workGuide.deleting") : t("admin.workGuide.delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showForm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            if (!submitting) {
              setShowForm(false);
              setEditingGuide(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {editingGuide ? t("admin.workGuide.modalEdit") : t("admin.workGuide.modalCreate")}
              </h2>
              <button
                onClick={() => {
                  if (!submitting) {
                    setShowForm(false);
                    setEditingGuide(null);
                  }
                }}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                disabled={submitting}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {t("admin.workGuide.fieldTitle")} <span className="text-red-500">{t("admin.workGuide.requiredMark")}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
                    required
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {t("admin.workGuide.fieldContent")} <span className="text-red-500">{t("admin.workGuide.requiredMark")}</span>
                  </label>
                  <textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    rows={12}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200 resize-none"
                    required
                    disabled={submitting}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t("admin.workGuide.fieldType")} <span className="text-red-500">{t("admin.workGuide.requiredMark")}</span>
                    </label>
                    <select
                      value={formData.guideType}
                      onChange={(e) => setFormData({ ...formData, guideType: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
                      required
                      disabled={submitting}
                    >
                      {GUIDE_TYPE_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {guideTypeLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t("admin.workGuide.fieldCategory")}
                    </label>
                    <input
                      type="text"
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      placeholder={t("admin.workGuide.categoryPlaceholder")}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
                      disabled={submitting}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t("admin.workGuide.fieldTags")}
                    </label>
                    <input
                      type="text"
                      value={formData.tags}
                      onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                      placeholder={t("admin.workGuide.tagsPlaceholder")}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
                      disabled={submitting}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t("admin.workGuide.fieldSourceUrl")}
                    </label>
                    <input
                      type="url"
                      value={formData.sourceUrl}
                      onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                      placeholder={t("admin.workGuide.sourcePlaceholder")}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-slate-200"
                      disabled={submitting}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => {
                    if (!submitting) {
                      setShowForm(false);
                      setEditingGuide(null);
                    }
                  }}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  disabled={submitting}
                >
                  {t("admin.workGuide.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting
                    ? t("admin.workGuide.saving")
                    : editingGuide
                      ? t("admin.workGuide.save")
                      : t("admin.workGuide.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200">{t("admin.workGuide.uploadTitle")}</h2>

            {uploadProgress ? (
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-700 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t("admin.workGuide.uploadSummary", {
                        success: uploadProgress.success,
                        failedPart:
                          uploadProgress.failed > 0
                            ? t("admin.workGuide.uploadFailedPart", { n: uploadProgress.failed })
                            : "",
                        totalPart:
                          uploadProgress.total > 0 ? t("admin.workGuide.uploadTotalPart", { n: uploadProgress.total }) : "",
                      })}
                    </span>
                    {uploadProgress.filesTotal && (
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {t("admin.workGuide.uploadFilesProgress", {
                          done: uploadProgress.filesProcessed || 0,
                          total: uploadProgress.filesTotal,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 relative overflow-hidden">
                    {uploadProgress.total > 0 && (
                      <div
                        className="bg-slate-400 dark:bg-slate-500 h-2 rounded-full transition-all duration-300 absolute inset-0"
                        style={{
                          width: `${Math.min(
                            ((uploadProgress.success + uploadProgress.failed) / uploadProgress.total) * 100,
                            100
                          )}%`,
                        }}
                      />
                    )}
                    {uploadProgress.total > 0 && (
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300 relative z-10"
                        style={{
                          width: `${Math.min((uploadProgress.success / uploadProgress.total) * 100, 100)}%`,
                        }}
                      />
                    )}
                    {uploadProgress.total === 0 && uploadProgress.filesTotal && (
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${
                            uploadProgress.filesTotal > 0
                              ? Math.min(((uploadProgress.filesProcessed || 0) / uploadProgress.filesTotal) * 100, 100)
                              : 0
                          }%`,
                        }}
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    {uploadProgress.total > 0
                      ? t("admin.workGuide.uploadProgressGuide", {
                          pct: Math.round(
                            ((uploadProgress.success + uploadProgress.failed) / uploadProgress.total) * 100
                          ),
                        })
                      : uploadProgress.filesTotal
                        ? t("admin.workGuide.uploadProgressFiles", {
                            done: uploadProgress.filesProcessed || 0,
                            total: uploadProgress.filesTotal,
                          })
                        : t("admin.workGuide.uploadProcessing")}
                  </p>
                </div>
                {uploadProgress.errors.length > 0 && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <h3 className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
                      {t("admin.workGuide.errorsHeading")}
                    </h3>
                    <ul className="space-y-1 text-xs text-red-700 dark:text-red-400">
                      {uploadProgress.errors.map((err, idx) => (
                        <li key={idx}>
                          {err.file}: {err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={async () => {
                      setShowUploadModal(false);
                      setUploadFiles([]);
                      setUploadProgress(null);
                      await loadGuides();
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    {t("admin.workGuide.ok")}
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (uploadFiles.length === 0) {
                    alert(t("admin.workGuide.selectFilesFirst"));
                    return;
                  }

                  setUploading(true);
                  setUploadProgress(null);

                  try {
                    const formDataUpload = new FormData();
                    uploadFiles.forEach((file) => {
                      formDataUpload.append("files", file);
                    });
                    formDataUpload.append("guideType", "general");
                    formDataUpload.append("autoSplit", "true");

                    const headers = createAuthHeaders(token);

                    const response = await fetch("/api/work-guides/upload", {
                      method: "POST",
                      headers,
                      body: formDataUpload,
                    });

                    if (response.ok) {
                      const data = await response.json();
                      setUploadProgress({
                        total: data.data.total || 0,
                        success: data.data.success || 0,
                        failed: data.data.failed || 0,
                        errors: data.data.errors || [],
                        filesProcessed: data.data.filesProcessed,
                        filesTotal: data.data.filesTotal,
                      });
                      await loadGuides();
                    } else {
                      const error = await response.json();
                      alert(
                        t("admin.workGuide.uploadFailed", {
                          message: error.message || t("admin.workGuide.unknownError"),
                        })
                      );
                    }
                  } catch (error) {
                    console.error("Failed to upload files:", error);
                    alert(t("admin.workGuide.uploadError"));
                  } finally {
                    setUploading(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                    {t("admin.workGuide.uploadPickLabel")}
                  </label>
                  <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center">
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.doc,.txt,.md,.markdown,.html,.htm"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        setUploadFiles(files);
                      }}
                      className="hidden"
                      id="file-upload"
                      disabled={uploading}
                    />
                    <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-2">
                      <span className="text-4xl">📁</span>
                      <span className="text-sm text-slate-600 dark:text-slate-400">{t("admin.workGuide.uploadDragHint")}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-500">{t("admin.workGuide.uploadLimits")}</span>
                    </label>
                  </div>
                  {uploadFiles.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t("admin.workGuide.selectedFiles", { n: uploadFiles.length })}
                      </p>
                      <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {uploadFiles.map((file, idx) => (
                          <li
                            key={idx}
                            className="text-sm text-slate-600 dark:text-slate-400 flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-700 rounded"
                          >
                            <span>{file.name}</span>
                            <span className="text-xs text-slate-500 dark:text-slate-500">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadFiles([]);
                      setUploadProgress(null);
                    }}
                    className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                    disabled={uploading}
                  >
                    {t("admin.workGuide.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={uploading || uploadFiles.length === 0}
                    className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {uploading ? t("admin.workGuide.uploading") : t("admin.workGuide.upload")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
