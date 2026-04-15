import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import ProjectSelector from "../../components/ProjectSelector";
import { createJsonHeaders } from "../../utils/headers";

interface Category {
  id: number;
  name: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  description?: string | null;
}

interface CategoryGroup {
  id: number;
  name: string;
  color?: string | null;
  description?: string | null;
  categories: Category[];
}

interface GroupDraft extends Pick<CategoryGroup, "name" | "description" | "color"> {}

const defaultGroupDraft: GroupDraft = {
  name: "",
  description: "",
  color: "#2563eb",
};

export default function CategoryManagement() {
  const { t, i18n } = useTranslation("pagesAdmin");
  const { token, selectedProjectId, projects } = useAuth();
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(defaultGroupDraft);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryImportance, setCategoryImportance] = useState<Category["importance"]>("MEDIUM");
  const [isSaving, setIsSaving] = useState(false);
  const [showCascadeConfirm, setShowCascadeConfirm] = useState(false);
  const [cloneFromProjectId, setCloneFromProjectId] = useState<number | null>(null);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    refresh();
  }, [selectedProjectId]);

  // 중복 제거된 그룹 목록 (이름 기준)
  const uniqueGroups = useMemo(() => {
    // ID 기준 중복 제거
    const idUnique = Array.from(
      new Map(groups.map((g) => [g.id, g])).values()
    );
    
    // 이름 기준 중복 제거 (같은 이름이면 ID가 작은 것 우선)
    const nameMap = new Map<string, CategoryGroup>();
    idUnique.forEach(g => {
      const existing = nameMap.get(g.name);
      if (!existing || g.id < existing.id) {
        nameMap.set(g.name, g);
      }
    });
    
    const locale = i18n.language === "ko" ? "ko" : "en";
    return Array.from(nameMap.values()).sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [groups]);

  const selectedGroup = useMemo(() => {
    const group = uniqueGroups.find((g) => g.id === selectedGroupId) || uniqueGroups[0] || null;
    if (group) {
      // 중분류 목록을 이름 순으로 정렬
      return {
        ...group,
        categories: [...group.categories].sort((a, b) => {
          const locale = i18n.language === "ko" ? "ko" : "en";
          return a.name.localeCompare(b.name, locale);
        }),
      };
    }
    return null;
  }, [uniqueGroups, selectedGroupId]);

  const authHeaders = useMemo(() => createJsonHeaders(token), [token]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      console.log('[CategoryManagement] Refreshing with projectId:', selectedProjectId);
      
      // projectId가 없으면 카테고리를 로드할 수 없음
      if (!selectedProjectId) {
        console.warn('[CategoryManagement] No projectId selected, clearing groups');
        setGroups([]);
        setLoading(false);
        return;
      }
      
      const url = `/api/categories/tree?projectId=${selectedProjectId}`;
      console.log('[CategoryManagement] Fetching from:', url);
      
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      const data = body.data || body;
      console.log('[CategoryManagement] Received data:', {
        projectId: selectedProjectId,
        groupCount: data?.length || 0,
        firstGroup: data?.[0]?.name,
        sampleGroups: data?.slice(0, 3).map((g: any) => ({ id: g.id, name: g.name, projectId: g.projectId }))
      });
      
      setGroups(data || []);
      
      // 중복 제거 후 첫 번째 그룹 선택
      if (!selectedGroupId && data?.length > 0) {
        // 이름 기준 중복 제거
        const nameMap = new Map();
        data.forEach((g: CategoryGroup) => {
          const existing = nameMap.get(g.name);
          if (!existing || g.id < existing.id) {
            nameMap.set(g.name, g);
          }
        });
        const uniqueData = Array.from(nameMap.values());
        if (uniqueData.length > 0) {
          setSelectedGroupId(uniqueData[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message || t("admin.category.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupDraft.name.trim()) {
      alert(t("admin.category.errors.needGroupName"));
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/categories/groups", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          ...groupDraft,
          projectId: selectedProjectId
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await refresh();
      setGroupDraft(defaultGroupDraft);
    } catch (err: any) {
      alert(err.message || t("admin.category.errors.createFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCloneFromProject() {
    if (!selectedProjectId) {
      alert(t("admin.category.errors.selectTargetProject"));
      return;
    }
    if (!cloneFromProjectId) {
      alert(t("admin.category.errors.selectSourceProject"));
      return;
    }
    if (cloneFromProjectId === selectedProjectId) {
      alert(t("admin.category.errors.cannotCloneSameProject"));
      return;
    }
    if (
      !confirm(
        t("admin.category.clone.confirm")
      )
    ) {
      return;
    }

    setCloning(true);
    try {
      const res = await fetch("/api/categories/clone-from-project", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          fromProjectId: cloneFromProjectId,
          toProjectId: selectedProjectId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const info = body.data || body;
      alert(
        t("admin.category.clone.done", {
          createdGroups: info.createdGroups ?? 0,
          createdCategories: info.createdCategories ?? 0,
          skippedGroups: info.skippedGroups ?? 0,
        })
      );
      await refresh();
    } catch (err: any) {
      alert(err.message || t("admin.category.errors.cloneFailed"));
    } finally {
      setCloning(false);
    }
  }

  async function handleUpdateGroup(partial: Partial<GroupDraft>, group: CategoryGroup) {
    try {
      const res = await fetch(`/api/categories/groups/${group.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(partial),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err: any) {
      alert(err.message || t("admin.category.errors.updateFailed"));
    }
  }

  async function handleDeleteGroup(group: CategoryGroup, cascade = false) {
    const msg = cascade
      ? t("admin.category.delete.confirmCascade", { name: group.name })
      : t("admin.category.delete.confirm", { name: group.name });
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/categories/groups/${group.id}?cascade=${cascade}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // cascade가 false인데 하위 카테고리가 있어 실패했다면 알림 후 cascade confirm 표시
        if (!cascade && body.message?.includes("cascade")) {
          setShowCascadeConfirm(true);
          return;
        }
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await refresh();
      setShowCascadeConfirm(false);
    } catch (err: any) {
      alert(err.message || t("admin.category.errors.deleteFailed"));
    }
  }

  async function handleAddCategory() {
    if (!selectedGroup) return;
    if (!categoryName.trim()) {
      alert(t("admin.category.errors.needCategoryName"));
      return;
    }
    try {
      const res = await fetch(`/api/categories`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          groupId: selectedGroup.id,
          name: categoryName.trim(),
          importance: categoryImportance,
          description: categoryDescription.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setCategoryName("");
      setCategoryDescription("");
      setCategoryImportance("MEDIUM");
      await refresh();
    } catch (err: any) {
      alert(err.message || t("admin.category.errors.addCategoryFailed"));
    }
  }

  async function handleDeleteCategory(categoryId: number) {
    if (!confirm(t("admin.category.delete.confirmCategory"))) return;
    try {
      const res = await fetch(`/api/categories/${categoryId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err: any) {
      alert(err.message || t("admin.category.errors.deleteCategoryFailed"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-800">{t("admin.category.title")}</h2>
            <p className="text-sm text-slate-500 mt-1">{t("admin.category.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t("admin.category.clone.label")}</span>
              <select
                className="border rounded-lg px-2 py-1 text-xs"
                value={cloneFromProjectId ?? ""}
                onChange={(e) => {
                  const value = e.target.value ? Number(e.target.value) : null;
                  setCloneFromProjectId(value);
                }}
              >
                <option value="">{t("admin.category.clone.selectPlaceholder")}</option>
                {projects
                  .filter((p) => p.id !== selectedProjectId)
                  .sort((a, b) => {
                    const locale = i18n.language === "ko" ? "ko" : "en";
                    return a.name.localeCompare(b.name, locale);
                  })
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleCloneFromProject}
                disabled={cloning || !cloneFromProjectId || !selectedProjectId}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                {cloning ? t("admin.category.clone.cloning") : t("admin.category.clone.run")}
              </button>
            </div>
            <ProjectSelector />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">{t("admin.category.groups.title")}</h2>
            <p className="text-sm text-slate-500">{t("admin.category.groups.subtitle")}</p>
          </div>
          <button
            onClick={() => refresh()}
            className="px-3 py-1.5 rounded-lg border text-sm text-slate-600 hover:bg-slate-50"
          >
            {t("admin.category.refresh")}
          </button>
        </div>

        {loading && <div className="text-slate-500 text-sm">{t("common.loading", { ns: "translation" })}</div>}
        {error && <div className="text-red-500 text-sm">{error}</div>}

        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {uniqueGroups.map((group) => (
            <div
              key={group.id}
              className={`border rounded-xl p-4 transition cursor-pointer ${
                selectedGroup?.id === group.id ? "border-blue-500 bg-blue-50" : "border-slate-200"
              }`}
              onClick={() => setSelectedGroupId(group.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={group.color || "#2563eb"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleUpdateGroup({ color: e.target.value }, group)}
                    className="w-10 h-10 rounded-full border cursor-pointer"
                    title="라벨 색상"
                  />
                  <div>
                    <div className="font-semibold text-slate-800 flex items-center gap-2">
                      {group.name}
                    </div>
                    {group.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="text-xs text-blue-600 hover:text-blue-800"
                    onClick={() => {
                      const newName = prompt(t("admin.category.groups.promptName"), group.name);
                      if (newName && newName.trim()) {
                        handleUpdateGroup({ name: newName.trim() }, group);
                      }
                    }}
                  >
                    {t("admin.category.groups.editName")}
                  </button>
                  <button
                    className="text-xs text-slate-500 hover:text-slate-700"
                    onClick={() => {
                      const desc = prompt(t("admin.category.groups.promptDescription"), group.description || "");
                      if (desc !== null) {
                        handleUpdateGroup({ description: desc }, group);
                      }
                    }}
                  >
                    {t("admin.category.groups.editDescription")}
                  </button>
                  <button
                    className="text-xs text-red-600 hover:text-red-800"
                    onClick={() => handleDeleteGroup(group)}
                  >
                    {t("admin.category.common.delete")}
                  </button>
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                <span>{t("admin.category.groups.categoryCount", { n: group.categories.length })}</span>
                {showCascadeConfirm && selectedGroup?.id === group.id && (
                  <button
                    className="text-red-600 underline"
                    onClick={() => handleDeleteGroup(group, true)}
                  >
                    {t("admin.category.delete.forceCascade")}
                  </button>
                )}
              </div>
            </div>
          ))}

          {uniqueGroups.length === 0 && !loading && (
            <div className="text-sm text-slate-500">{t("admin.category.groups.empty")}</div>
          )}
        </div>

        <form onSubmit={handleCreateGroup} className="border rounded-xl p-4 space-y-3 bg-slate-50">
          <h3 className="font-semibold text-slate-800 text-sm">{t("admin.category.groups.addTitle")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">{t("admin.category.common.name")}</label>
              <input
                type="text"
                value={groupDraft.name}
                onChange={(e) => setGroupDraft((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                placeholder={t("admin.category.groups.placeholders.name")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">{t("admin.category.common.color")}</label>
              <input
                type="color"
                value={groupDraft.color || "#2563eb"}
                onChange={(e) => setGroupDraft((prev) => ({ ...prev, color: e.target.value }))}
                className="mt-1 w-full h-10 border rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">{t("admin.category.common.description")}</label>
              <input
                type="text"
                value={groupDraft.description || ""}
                onChange={(e) => setGroupDraft((prev) => ({ ...prev, description: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                placeholder={t("admin.category.groups.placeholders.description")}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="w-full mt-2 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {isSaving ? t("admin.category.common.saving") : t("admin.category.groups.addButton")}
          </button>
        </form>
      </div>

      <div className="bg-white border rounded-2xl shadow-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">{t("admin.category.categories.title")}</h2>
            <p className="text-sm text-slate-500">
              {t("admin.category.categories.subtitle")}
            </p>
          </div>
          {selectedGroup && (
            <span
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: selectedGroup.color || "#e0f2fe",
                color: "#1e293b",
              }}
            >
              {t("admin.category.categories.preview")}
            </span>
          )}
        </div>

        {!selectedGroup && <div className="text-sm text-slate-500">{t("admin.category.categories.selectGroupFirst")}</div>}

        {selectedGroup && (
          <>
            <div className="border rounded-xl p-4">
              <h3 className="font-semibold text-slate-800">{selectedGroup.name}</h3>
              {selectedGroup.description && (
                <p className="text-sm text-slate-500 mt-1">{selectedGroup.description}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedGroup.categories.map((category) => (
                  <span
                    key={category.id}
                    className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-sm"
                  >
                    <span className="font-semibold">{category.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      {t(`admin.category.importance.${category.importance}`)}
                    </span>
                    <button
                      className="text-xs text-red-500 hover:text-red-700"
                      onClick={() => handleDeleteCategory(category.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selectedGroup.categories.length === 0 && (
                  <div className="text-sm text-slate-400">{t("admin.category.categories.empty")}</div>
                )}
              </div>
            </div>

            <div className="border rounded-xl p-4 bg-slate-50 space-y-3">
              <h4 className="font-semibold text-sm text-slate-700">{t("admin.category.categories.addTitle")}</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">{t("admin.category.categories.fields.name")}</label>
                  <input
                    type="text"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder={t("admin.category.categories.placeholders.name")}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">{t("admin.category.common.description")}</label>
                  <input
                    type="text"
                    value={categoryDescription}
                    onChange={(e) => setCategoryDescription(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder={t("admin.category.categories.placeholders.description")}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">{t("admin.category.categories.fields.importance")}</label>
                  <select
                    value={categoryImportance}
                    onChange={(e) => setCategoryImportance(e.target.value as Category["importance"])}
                    className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="HIGH">{t("admin.category.importance.HIGH")}</option>
                    <option value="MEDIUM">{t("admin.category.importance.MEDIUM")}</option>
                    <option value="LOW">{t("admin.category.importance.LOW")}</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleAddCategory}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
              >
                {t("admin.category.categories.addButton")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  );
}




