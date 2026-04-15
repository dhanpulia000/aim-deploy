import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { createAuthHeaders } from "../../utils/headers";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

interface HandoverRecord {
  id: number;
  workDate: string;
  workType: string;
  content: string;
  authorId?: string | null;
  authorName?: string | null;
  createdAt: string;
  updatedAt: string;
}

const WORK_TYPE_VALUES = ["주간", "오후", "야간", "정오"] as const;

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;

function ContentWithLinks({ text }: { text: string }) {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function HandoverPage() {
  const { t, i18n } = useTranslation("pagesAgent");
  const dateLocale = i18n.language?.startsWith("ko") ? "ko-KR" : "en-US";
  const { token, user } = useAuth();

  const formatDateLabel = useCallback(
    (d: string) => {
      const date = new Date(d + "T12:00:00");
      const today = new Date();
      const isToday =
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate();
      const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
      const week = t(`workChecklist.weekday.${keys[date.getDay()]}`);
      return isToday ? t("workChecklist.today", { date: d }) : `${d} (${week})`;
    },
    [t]
  );

  const workTypeLabel = useCallback(
    (value: string) => t(`workChecklist.workTypeLabels.${value}` as const),
    [t]
  );
  const [workDate, setWorkDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [records, setRecords] = useState<HandoverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ workDate: string; workType: string } | null>(null);
  const [formContent, setFormContent] = useState("");
  const [saving, setSaving] = useState(false);

  const loadRecords = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workDate,
      });
      const res = await fetch(`/api/handover/records?${params}`, {
        headers: createAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setRecords(json.data?.records ?? json?.records ?? []);
      } else {
        setRecords([]);
      }
    } catch (e) {
      console.error("Failed to load handover records", e);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [token, workDate]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const openCreate = (workType: string) => {
    setEditing({ workDate, workType });
    const existing = records.find(
      (r) => r.workDate === workDate && r.workType === workType
    );
    setFormContent(existing?.content ?? "");
  };

  const saveRecord = async () => {
    if (!token || !editing) return;

    setSaving(true);
    try {
      const res = await fetch("/api/handover/records", {
        method: "PUT",
        headers: {
          ...createAuthHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workDate: editing.workDate,
          workType: editing.workType,
          content: formContent.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || t("handover.alertSaveFailed"));
        return;
      }

      setEditing(null);
      loadRecords();
    } catch (e) {
      console.error("Failed to save", e);
      alert(t("handover.alertSaveFailedGeneric"));
    } finally {
      setSaving(false);
    }
  };

  const getRecordForType = (workType: string) =>
    records.find((r) => r.workType === workType);

  if (!user) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-800">
        {t("handover.loginRequired")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("handover.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("handover.subtitle")}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-2 block text-sm font-medium text-slate-700">{t("handover.date")}</label>
        <LocalizedDateInput
          type="date"
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-slate-500">{formatDateLabel(workDate)}</p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
          {t("handover.loading")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {WORK_TYPE_VALUES.map((value) => {
            const rec = getRecordForType(value);
            return (
              <div
                key={value}
                className="rounded-xl border-2 border-slate-200 bg-white overflow-hidden shadow-sm hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <h3 className="font-semibold text-slate-800">{workTypeLabel(value)}</h3>
                  <button
                    type="button"
                    onClick={() =>
                      openCreate(value)
                    }
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    {rec ? t("handover.edit") : t("handover.write")}
                  </button>
                </div>
                <div className="min-h-[100px] p-4">
                  {rec?.content ? (
                    <div className="whitespace-pre-wrap text-sm text-slate-700">
                      {rec.content.split("\n").map((line, i) => (
                        <span key={i}>
                          <ContentWithLinks text={line} />
                          {i < rec.content.split("\n").length - 1 && <br />}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">{t("handover.empty")}</p>
                  )}
                  {rec?.authorName && (
                    <p className="mt-2 text-xs text-slate-500">
                      {t("handover.meta", {
                        author: rec.authorName,
                        time: new Date(rec.updatedAt).toLocaleString(dateLocale),
                      })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">
              {t("handover.modalTitle", {
                date: formatDateLabel(editing.workDate),
                workType: workTypeLabel(editing.workType),
              })}
            </h3>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={t("handover.placeholder")}
              rows={10}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {t("handover.cancel")}
              </button>
              <button
                onClick={saveRecord}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {saving ? t("handover.saving") : t("handover.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
