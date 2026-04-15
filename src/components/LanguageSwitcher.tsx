import { useTranslation } from "react-i18next";
import { LOCALE_STORAGE_KEY } from "../i18n/config";
import { cn } from "../utils/cn";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const active = i18n.resolvedLanguage?.startsWith("ko") ? "ko" : "en";

  const setLang = (lng: "en" | "ko") => {
    void i18n.changeLanguage(lng);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, lng);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-slate-200/80 bg-white/80 p-0.5 text-xs font-semibold shadow-sm",
        className
      )}
      role="group"
      aria-label={t("lang.switcherAria")}
    >
      <button
        type="button"
        onClick={() => setLang("en")}
        className={cn(
          "rounded-md px-2 py-1 transition-colors",
          active === "en" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
        )}
        aria-pressed={active === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("ko")}
        className={cn(
          "rounded-md px-2 py-1 transition-colors",
          active === "ko" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
        )}
        aria-pressed={active === "ko"}
      >
        KO
      </button>
    </div>
  );
}
