import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createJsonHeaders } from "../../utils/headers";

interface AIPrompt {
  id: number;
  name: string;
  displayName: string;
  description: string | null;
  systemPrompt: string;
  userPromptTemplate: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export default function AIPromptManagement() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token } = useAuth();
  const [prompts, setPrompts] = useState<AIPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<AIPrompt | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<Partial<AIPrompt> | null>(null);
  const [saving, setSaving] = useState(false);

  const authHeaders = useMemo(() => createJsonHeaders(token), [token]);

  useEffect(() => {
    loadPrompts();
  }, []);

  async function loadPrompts() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-prompts', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const body = await res.json();
      const data = body.data || body;
      setPrompts(Array.isArray(data) ? data : []);
      
      if (!selectedPrompt && data.length > 0) {
        setSelectedPrompt(data[0]);
      }
    } catch (err: any) {
      setError(err.message || t("admin.aiPrompts.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(prompt: AIPrompt) {
    setEditingPrompt({
      ...prompt,
      isActive: Boolean(prompt.isActive)
    });
  }

  function handleCancelEdit() {
    setEditingPrompt(null);
  }

  async function handleSave() {
    if (!editingPrompt || !editingPrompt.name) return;
    
    setSaving(true);
    try {
      const res = await fetch(`/api/ai-prompts/${editingPrompt.name}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          displayName: editingPrompt.displayName,
          description: editingPrompt.description,
          systemPrompt: editingPrompt.systemPrompt,
          userPromptTemplate: editingPrompt.userPromptTemplate,
          isActive: editingPrompt.isActive
        }),
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      
      alert(t("admin.aiPrompts.errors.saved"));
      await loadPrompts();
      setEditingPrompt(null);
      
      // 선택된 프롬프트 업데이트
      const updated = await res.json();
      if (updated.data) {
        setSelectedPrompt(updated.data);
      }
    } catch (err: any) {
      alert(err.message || t("admin.aiPrompts.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const isEditing = editingPrompt !== null;
  const displayPrompt = isEditing ? editingPrompt : selectedPrompt;

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{t("admin.aiPrompts.title")}</h2>
            <p className="text-sm text-slate-500 mt-1">{t("admin.aiPrompts.subtitle")}</p>
          </div>
          <button
            onClick={() => loadPrompts()}
            className="px-3 py-1.5 rounded-lg border text-sm text-slate-600 hover:bg-slate-50"
          >
            {t("admin.aiPrompts.refresh")}
          </button>
        </div>

        {loading && <div className="text-slate-500 text-sm">{t("admin.aiPrompts.loading")}</div>}
        {error && <div className="text-red-500 text-sm">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 왼쪽: 프롬프트 목록 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">{t("admin.aiPrompts.listTitle")}</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`border rounded-lg p-3 cursor-pointer transition ${
                    selectedPrompt?.id === prompt.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                  onClick={() => {
                    setSelectedPrompt(prompt);
                    setEditingPrompt(null);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 flex items-center gap-2">
                        {prompt.displayName}
                        {prompt.isActive ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                            {t("admin.aiPrompts.active")}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                            {t("admin.aiPrompts.inactive")}
                          </span>
                        )}
                      </div>
                      {prompt.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                          {prompt.description}
                        </p>
                      )}
                      <div className="text-xs text-slate-400 mt-1">
                        v{prompt.version} • {prompt.name}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {prompts.length === 0 && !loading && (
                <div className="text-sm text-slate-500">{t("admin.aiPrompts.empty")}</div>
              )}
            </div>
          </div>

          {/* 오른쪽: 프롬프트 상세/편집 */}
          <div className="lg:col-span-2 space-y-4">
            {displayPrompt ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-800">
                    {isEditing ? t("admin.aiPrompts.editTitle") : t("admin.aiPrompts.detailTitle")}
                  </h3>
                  <div className="flex gap-2">
                    {isEditing ? (
                      <>
                        <button
                          onClick={handleCancelEdit}
                          disabled={saving}
                          className="px-3 py-1.5 text-sm border rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t("admin.aiPrompts.cancel")}
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {saving ? t("admin.aiPrompts.saving") : t("admin.aiPrompts.save")}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => selectedPrompt && handleEdit(selectedPrompt)}
                        className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-900"
                      >
                        {t("admin.aiPrompts.edit")}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2">
                  {/* 기본 정보 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t("admin.aiPrompts.fields.displayName")}
                      </label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingPrompt.displayName || ''}
                          onChange={(e) =>
                            setEditingPrompt({ ...editingPrompt, displayName: e.target.value })
                          }
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      ) : (
                        <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-medium">
                          {displayPrompt.displayName}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t("admin.aiPrompts.fields.identifier")}
                      </label>
                      <div className="px-3 py-2 bg-slate-100 rounded-lg text-sm text-slate-600">
                        {displayPrompt.name}
                      </div>
                    </div>
                  </div>

                  {/* 설명 */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t("admin.aiPrompts.fields.description")}
                    </label>
                    {isEditing ? (
                      <textarea
                        value={editingPrompt.description || ''}
                        onChange={(e) =>
                          setEditingPrompt({ ...editingPrompt, description: e.target.value })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        rows={2}
                      />
                    ) : (
                      <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm">
                        {displayPrompt.description || t("admin.aiPrompts.fields.noDescription")}
                      </div>
                    )}
                  </div>

                  {/* 활성화 상태 */}
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      {isEditing ? (
                        <>
                          <input
                            type="checkbox"
                            checked={editingPrompt.isActive || false}
                            onChange={(e) =>
                              setEditingPrompt({ ...editingPrompt, isActive: e.target.checked })
                            }
                            className="w-4 h-4"
                          />
                          <span className="text-sm font-medium text-slate-700">
                            {t("admin.aiPrompts.fields.enable")}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-slate-600">
                          {t("admin.aiPrompts.fields.status")}{" "}
                          {displayPrompt.isActive ? t("admin.aiPrompts.fields.statusActive") : t("admin.aiPrompts.fields.statusInactive")}
                        </span>
                      )}
                    </label>
                  </div>

                  {/* 시스템 프롬프트 */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t("admin.aiPrompts.fields.systemPrompt")}
                    </label>
                    {isEditing ? (
                      <textarea
                        value={editingPrompt.systemPrompt || ''}
                        onChange={(e) =>
                          setEditingPrompt({ ...editingPrompt, systemPrompt: e.target.value })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                        rows={20}
                        placeholder={t("admin.aiPrompts.fields.systemPlaceholder")}
                      />
                    ) : (
                      <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-mono whitespace-pre-wrap max-h-96 overflow-y-auto border">
                        {displayPrompt.systemPrompt}
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      {t("admin.aiPrompts.fields.systemHint")}
                    </p>
                  </div>

                  {/* 사용자 프롬프트 템플릿 */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t("admin.aiPrompts.fields.userTemplate")}
                    </label>
                    {isEditing ? (
                      <textarea
                        value={editingPrompt.userPromptTemplate || ''}
                        onChange={(e) =>
                          setEditingPrompt({
                            ...editingPrompt,
                            userPromptTemplate: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                        rows={5}
                        placeholder={t("admin.aiPrompts.fields.userTemplatePlaceholder")}
                      />
                    ) : (
                      <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border">
                        {displayPrompt.userPromptTemplate || t("admin.aiPrompts.fields.noTemplate")}
                      </div>
                    )}
                  </div>

                  {/* 메타 정보 */}
                  <div className="border-t pt-4">
                    <div className="grid grid-cols-3 gap-4 text-xs text-slate-500">
                      <div>
                        <span className="font-medium">{t("admin.aiPrompts.fields.metaVersion")}</span> v{displayPrompt.version}
                      </div>
                      <div>
                        <span className="font-medium">{t("admin.aiPrompts.fields.metaCreated")}</span>{' '}
                        {displayPrompt.createdAt ? new Date(displayPrompt.createdAt).toLocaleDateString(i18n.language === "ko" ? "ko-KR" : "en-US") : '-'}
                      </div>
                      <div>
                        <span className="font-medium">{t("admin.aiPrompts.fields.metaUpdated")}</span>{' '}
                        {displayPrompt.updatedAt ? new Date(displayPrompt.updatedAt).toLocaleDateString(i18n.language === "ko" ? "ko-KR" : "en-US") : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500">{t("admin.aiPrompts.selectHint")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

