import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";

interface StepFloatingItem {
  id: number;
  title: string;
  content: string;
  position: "left" | "right";
  sortOrder: number;
  isActive: number;
}

export default function StepFloatingManagement() {
  const { t } = useTranslation("pagesAdmin");
  const { token, user } = useAuth();
  const [items, setItems] = useState<StepFloatingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<StepFloatingItem | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formPosition, setFormPosition] = useState<"left" | "right">("right");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadItems = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/step-floating/items?includeInactive=true", {
        headers: createAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data?.items ?? json?.items ?? [];
        setItems(data);
      }
    } catch (e) {
      console.error("Failed to load step floating items", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && (user?.role === "ADMIN" || user?.role === "LEAD" || user?.role === "SUPERADMIN")) {
      loadItems();
    }
  }, [token, user]);

  const openCreate = () => {
    setEditingItem(null);
    setFormTitle("");
    setFormContent("");
    setFormPosition("right");
    setShowForm(true);
  };

  const openEdit = (item: StepFloatingItem) => {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormContent(item.content);
    setFormPosition(item.position);
    setShowForm(true);
  };

  const saveItem = async () => {
    if (!token || !formTitle.trim()) {
      alert(t("admin.stepFloating.needTitle"));
      return;
    }

    setSaving(true);
    try {
      const url = editingItem
        ? `/api/step-floating/items/${editingItem.id}`
        : "/api/step-floating/items";
      const method = editingItem ? "PATCH" : "POST";
      const body = JSON.stringify({
        title: formTitle.trim(),
        content: formContent.trim(),
        position: formPosition,
      });

      const res = await fetch(url, {
        method,
        headers: {
          ...createAuthHeaders(token),
          "Content-Type": "application/json",
        },
        body,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert((err as { message?: string }).message || t("admin.stepFloating.saveFailed"));
        return;
      }

      setShowForm(false);
      loadItems();
    } catch (e) {
      console.error("Failed to save", e);
      alert(t("admin.stepFloating.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm(t("admin.stepFloating.deleteConfirm"))) return;
    if (!token) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/step-floating/items/${id}`, {
        method: "DELETE",
        headers: createAuthHeaders(token),
      });

      if (res.ok) {
        loadItems();
      } else {
        const err = await res.json().catch(() => ({}));
        alert((err as { message?: string }).message || t("admin.stepFloating.deleteFailed"));
      }
    } catch (e) {
      console.error("Failed to delete", e);
      alert(t("admin.stepFloating.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  if (!user || !["ADMIN", "LEAD", "SUPERADMIN"].includes(user.role || "")) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-800">
        {t("admin.stepFloating.needAdmin")}
      </div>
    );
  }

  const leftItems = items.filter((i) => i.position === "left");
  const rightItems = items.filter((i) => i.position === "right");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("admin.stepFloating.title")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("admin.stepFloating.subtitle")}</p>
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-amber-600 hover:to-orange-700"
        >
          {t("admin.stepFloating.addItem")}
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          {t("admin.stepFloating.loading")}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border-2 border-amber-200 bg-white overflow-hidden">
            <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
              <h2 className="font-semibold text-slate-800">
                {t("admin.stepFloating.leftColumn", { n: leftItems.length })}
              </h2>
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {leftItems.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">{t("admin.stepFloating.empty")}</div>
              ) : (
                leftItems.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-2 p-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">{item.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.content}</div>
                    </div>
                    <div className="shrink-0 flex gap-1">
                      <button
                        onClick={() => openEdit(item)}
                        className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                      >
                        {t("admin.stepFloating.edit")}
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        disabled={deletingId === item.id}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("admin.stepFloating.delete")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border-2 border-amber-200 bg-white overflow-hidden">
            <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
              <h2 className="font-semibold text-slate-800">
                {t("admin.stepFloating.rightColumn", { n: rightItems.length })}
              </h2>
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {rightItems.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">{t("admin.stepFloating.empty")}</div>
              ) : (
                rightItems.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-2 p-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">{item.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.content}</div>
                    </div>
                    <div className="shrink-0 flex gap-1">
                      <button
                        onClick={() => openEdit(item)}
                        className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                      >
                        {t("admin.stepFloating.edit")}
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        disabled={deletingId === item.id}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("admin.stepFloating.delete")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">
              {editingItem ? t("admin.stepFloating.formEdit") : t("admin.stepFloating.formAdd")}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t("admin.stepFloating.fieldTitle")}
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={t("admin.stepFloating.placeholderTitle")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t("admin.stepFloating.fieldPosition")}
                </label>
                <select
                  value={formPosition}
                  onChange={(e) => setFormPosition(e.target.value as "left" | "right")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="left">{t("admin.stepFloating.positionLeft")}</option>
                  <option value="right">{t("admin.stepFloating.positionRight")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t("admin.stepFloating.fieldContent")}
                </label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder={t("admin.stepFloating.placeholderContent")}
                  rows={8}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-y"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {t("admin.stepFloating.cancel")}
              </button>
              <button
                onClick={saveItem}
                disabled={saving || !formTitle.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
              >
                {saving ? t("admin.stepFloating.saving") : t("admin.stepFloating.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
