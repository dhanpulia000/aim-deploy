import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface Project {
  id: number;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export default function ProjectManagement({ 
  projects: initialProjects, 
  onRefresh,
  token 
}: { 
  projects: Project[]; 
  onRefresh: () => Promise<void>;
  token: string | null;
}) {
  const { t } = useTranslation("pagesAdmin");
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", description: "" });

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const loadProjects = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      const data = body.data || body;
      setProjects(Array.isArray(data) ? data : []);
      await onRefresh();
    } catch (err: any) {
      setError(err.message || t("admin.projects.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 컴포넌트 마운트 시 프로젝트 목록 로드
    if (token) {
      loadProjects();
    }
     
  }, [token]);

  const handleCreate = () => {
    setEditingProject(null);
    setFormData({ name: "", description: "" });
    setShowForm(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      description: project.description || ""
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!formData.name.trim()) {
      alert(t("admin.projects.errors.needName"));
      return;
    }

    setLoading(true);
    try {
      const url = editingProject 
        ? `/api/projects/${editingProject.id}`
        : "/api/projects";
      const method = editingProject ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      await loadProjects();
      setShowForm(false);
      setEditingProject(null);
      setFormData({ name: "", description: "" });
    } catch (err: any) {
      alert(err.message || t("admin.projects.errors.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (project: Project) => {
    if (!token) return;
    if (!confirm(t("admin.projects.form.confirmDelete", { name: project.name }))) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      await loadProjects();
    } catch (err: any) {
      alert(err.message || t("admin.projects.errors.deleteFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{t("admin.projects.title")}</h2>
            <p className="text-sm text-slate-500 mt-1">{t("admin.projects.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + {t("admin.projects.addProject")}
            </button>
            <button
              onClick={loadProjects}
              className="px-3 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50"
            >
              {t("admin.projects.refresh")}
            </button>
          </div>
        </div>

        {loading && <div className="text-slate-500 text-sm py-4">{t("admin.projects.loading")}</div>}
        {error && <div className="text-red-500 text-sm py-4">{error}</div>}

        <div className="space-y-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50"
            >
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800">{project.name}</h3>
                {project.description && (
                  <p className="text-sm text-slate-500 mt-1">{project.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  ID: {project.id}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(project)}
                  className="px-3 py-1.5 text-sm border rounded-lg text-slate-600 hover:bg-slate-100"
                >
                  {t("admin.projects.edit")}
                </button>
                <button
                  onClick={() => handleDelete(project)}
                  className="px-3 py-1.5 text-sm border rounded-lg text-red-600 hover:bg-red-50"
                >
                  {t("admin.projects.delete")}
                </button>
              </div>
            </div>
          ))}

          {projects.length === 0 && !loading && (
            <div className="text-center text-slate-500 py-8">
              {t("admin.projects.empty")}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">
              {editingProject ? t("admin.projects.form.editTitle") : t("admin.projects.form.addTitle")}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.projects.form.name")}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder={t("admin.projects.form.namePlaceholder")}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.projects.form.description")}</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={3}
                  placeholder={t("admin.projects.form.descriptionPlaceholder")}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingProject(null);
                    setFormData({ name: "", description: "" });
                  }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  {t("admin.projects.form.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? t("admin.projects.form.saving") : t("admin.projects.form.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

