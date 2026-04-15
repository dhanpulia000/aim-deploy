import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CustomerFeedbackNotice } from "../types";
import { LocalizedDateInput } from "./LocalizedDateInput";

export type NoticeFormValue = {
  title: string;
  gameName: string;
  managerName: string;
  category: string;
  content: string;
  noticeDate: string;
  url: string;
};

const GAME_COMMON_KO = "공통";
const GAME_COMMON_EN = "Common";

function buildInitialForm(editingNotice: CustomerFeedbackNotice | null): NoticeFormValue {
  if (!editingNotice) {
    return {
      title: "",
      gameName: "",
      managerName: "",
      category: "",
      content: "",
      noticeDate: new Date().toISOString().split("T")[0],
      url: "",
    };
  }

  return {
    title: editingNotice.title ?? "",
    gameName: editingNotice.gameName ?? "",
    managerName: editingNotice.managerName ?? "",
    category: editingNotice.category ?? "",
    content: editingNotice.content ?? "",
    noticeDate: editingNotice.noticeDate
      ? new Date(editingNotice.noticeDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    url: editingNotice.url ?? "",
  };
}

export function NoticeEditor(props: {
  editingNotice: CustomerFeedbackNotice | null;
  availableGames: string[];
  gameLabelByCode?: Record<string, string>;
  submitting: boolean;
  onCancel: () => void;
  onSave: (form: NoticeFormValue) => void;
  onEnd?: (noticeId: number) => void;
}) {
  const { t, i18n } = useTranslation("components");
  const { editingNotice, availableGames, gameLabelByCode, submitting, onCancel, onSave, onEnd } = props;

  const [form, setForm] = useState<NoticeFormValue>(() => buildInitialForm(editingNotice));

  useEffect(() => {
    setForm(buildInitialForm(editingNotice));
  }, [editingNotice?.id]);

  const gameCommonLabel = i18n.language?.startsWith("ko") ? GAME_COMMON_KO : GAME_COMMON_EN;

  const gameOptions = useMemo(() => {
    const baseOptions =
      availableGames.length > 0 ? availableGames.map((g) => gameLabelByCode?.[g] ?? g) : [];
    return Array.from(new Set([...baseOptions, gameCommonLabel]));
  }, [availableGames, gameLabelByCode, gameCommonLabel]);

  const currentGameVal = (form.gameName || "").trim();
  const hasCurrentGame = currentGameVal && !gameOptions.includes(currentGameVal);

  return (
    <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
      <h3 className="text-sm font-semibold mb-3">
        {editingNotice ? t("noticeEditor.editTitle") : t("noticeEditor.newTitle")}
      </h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldTitle")}</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t("noticeEditor.titlePlaceholder")}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldGame")}</label>
          <select
            value={form.gameName}
            onChange={(e) => setForm({ ...form, gameName: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">{t("noticeEditor.selectPlaceholder")}</option>
            {gameOptions.map((val) => (
              <option key={val} value={val}>
                {val}
              </option>
            ))}
            {hasCurrentGame && (
              <option value={currentGameVal}>
                {currentGameVal}
                {t("noticeEditor.gameExistingSuffix")}
              </option>
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldManager")}</label>
          <input
            type="text"
            value={form.managerName}
            onChange={(e) => setForm({ ...form, managerName: e.target.value })}
            placeholder={t("noticeEditor.managerPlaceholder")}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldCategory")}</label>
          <input
            type="text"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder={t("noticeEditor.categoryPlaceholder")}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldDate")}</label>
          <LocalizedDateInput
            type="date"
            required
            value={form.noticeDate}
            onChange={(e) => setForm({ ...form, noticeDate: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldUrl")}</label>
          <input
            type="url"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder={t("noticeEditor.urlPlaceholder")}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-slate-600 mb-1">{t("noticeEditor.fieldContent")}</label>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder={t("noticeEditor.contentPlaceholder")}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex justify-end gap-2 flex-wrap">
        {editingNotice && !editingNotice.endedAt && onEnd && (
          <button
            type="button"
            onClick={() => onEnd(editingNotice.id)}
            className="px-4 py-2 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors"
          >
            {t("noticeEditor.end")}
          </button>
        )}
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
        >
          {t("noticeEditor.cancel")}
        </button>
        <button
          onClick={() =>
            onSave({
              ...form,
              gameName:
                form.gameName.trim() === GAME_COMMON_EN || form.gameName.trim() === GAME_COMMON_KO
                  ? GAME_COMMON_KO
                  : form.gameName,
            })
          }
          disabled={submitting}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {submitting
            ? t("noticeEditor.saving")
            : editingNotice
              ? t("noticeEditor.edit")
              : t("noticeEditor.save")}
        </button>
      </div>
    </div>
  );
}
