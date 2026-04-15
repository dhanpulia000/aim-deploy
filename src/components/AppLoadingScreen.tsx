import { useTranslation } from "react-i18next";

export function AppLoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
      {t("common.loading")}
    </div>
  );
}
