import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en/translation.json";
import ko from "../locales/ko/translation.json";
import appEn from "../locales/en/app.json";
import appKo from "../locales/ko/app.json";
import componentsEn from "../locales/en/components.json";
import componentsKo from "../locales/ko/components.json";
import pagesAgentEn from "../locales/en/pagesAgent.json";
import pagesAgentKo from "../locales/ko/pagesAgent.json";
import pagesCalendarEn from "../locales/en/pagesCalendar.json";
import pagesCalendarKo from "../locales/ko/pagesCalendar.json";
import pagesStandaloneEn from "../locales/en/pagesStandalone.json";
import pagesStandaloneKo from "../locales/ko/pagesStandalone.json";
import pagesAdminEn from "../locales/en/pagesAdmin.json";
import pagesAdminKo from "../locales/ko/pagesAdmin.json";

export const LOCALE_STORAGE_KEY = "aim.locale";

export function getStoredLocale(): "en" | "ko" | null {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === "en" || v === "ko") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function applyDocumentLang(lng: string) {
  document.documentElement.lang = lng === "ko" ? "ko" : "en";
}

const initialLng = getStoredLocale() ?? "en";

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: en,
      app: appEn,
      components: componentsEn,
      pagesAgent: pagesAgentEn,
      pagesCalendar: pagesCalendarEn,
      pagesStandalone: pagesStandaloneEn,
      pagesAdmin: pagesAdminEn
    },
    ko: {
      translation: ko,
      app: appKo,
      components: componentsKo,
      pagesAgent: pagesAgentKo,
      pagesCalendar: pagesCalendarKo,
      pagesStandalone: pagesStandaloneKo,
      pagesAdmin: pagesAdminKo
    }
  },
  ns: ["translation", "app", "components", "pagesAgent", "pagesCalendar", "pagesStandalone", "pagesAdmin"],
  defaultNS: "translation",
  lng: initialLng,
  fallbackLng: "en",
  supportedLngs: ["en", "ko"],
  interpolation: { escapeValue: false },
  react: { useSuspense: false }
});

applyDocumentLang(i18n.language);
i18n.on("languageChanged", applyDocumentLang);

export default i18n;
