import type { i18n as I18nApi } from "i18next";

/** User manual static HTML (Korean custom page vs English markdown build). */
export function agentManualBasePath(i18n: I18nApi): string {
  const lng = i18n.resolvedLanguage || i18n.language || "en";
  return lng.startsWith("ko") ? "/agent-manual.html" : "/agent-manual-en.html";
}
