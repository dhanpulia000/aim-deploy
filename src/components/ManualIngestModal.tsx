import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";

interface ManualIngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ManualIngestModal({ isOpen, onClose, onSuccess }: ManualIngestModalProps) {
  const { t } = useTranslation("components");
  const [url, setUrl] = useState("");
  const [cookies, setCookies] = useState("");
  const [showCookieHelp, setShowCookieHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("naverCafeManualCookie");
      if (saved && !cookies) {
        setCookies(saved);
      }
    } catch {
      /* ignore */
    }
  }, [cookies]);

  if (!isOpen) return null;

  const validateUrl = (urlToValidate: string): boolean => {
    try {
      const urlObj = new URL(urlToValidate);
      return urlObj.hostname.includes("cafe.naver.com");
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedUrl = url.trim();
    const trimmedCookies = cookies.trim();

    if (!trimmedUrl) {
      setError(t("manualIngest.errorUrlRequired"));
      return;
    }

    if (!validateUrl(trimmedUrl)) {
      setError(t("manualIngest.errorUrlInvalid"));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      try {
        if (typeof window !== "undefined") {
          if (trimmedCookies) {
            window.localStorage.setItem("naverCafeManualCookie", trimmedCookies);
          } else {
            window.localStorage.removeItem("naverCafeManualCookie");
          }
        }
      } catch {
        /* ignore */
      }

      const response = await fetch("/api/ingestion/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          url: trimmedUrl,
          ...(trimmedCookies ? { cookies: trimmedCookies } : {})
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || t("manualIngest.errorIngestFailed"));
      }

      setUrl("");
      setCookies("");
      setError(null);

      if (onSuccess) {
        onSuccess();
      }

      alert(t("manualIngest.success"));

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("manualIngest.errorIngestFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setUrl("");
      setCookies("");
      setError(null);
      setShowCookieHelp(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border dark:border-slate-700 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("manualIngest.title")}</h3>
            <button
              onClick={handleClose}
              disabled={loading}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-50"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {t("manualIngest.urlLabel")}
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://cafe.naver.com/..."
                disabled={loading}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg 
                         bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("manualIngest.urlHint")}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t("manualIngest.cookiesLabel")}
                </label>
                <button
                  type="button"
                  onClick={() => setShowCookieHelp(!showCookieHelp)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {showCookieHelp ? t("manualIngest.cookieHelpHide") : t("manualIngest.cookieHelpShow")}
                </button>
              </div>

              {showCookieHelp && (
                <div className="mb-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-slate-700 dark:text-slate-300">
                  <p className="font-semibold mb-2">{t("manualIngest.cookieHelpTitle")}</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>{t("manualIngest.cookieHelpLi1")}</li>
                    <li>{t("manualIngest.cookieHelpLi2")}</li>
                    <li>{t("manualIngest.cookieHelpLi3")}</li>
                    <li>{t("manualIngest.cookieHelpLi4")}</li>
                    <li>{t("manualIngest.cookieHelpLi5")}</li>
                    <li>{t("manualIngest.cookieHelpLi6")}</li>
                  </ol>
                  <p className="mt-2 text-slate-600 dark:text-slate-400">{t("manualIngest.cookieHelpTip")}</p>
                </div>
              )}

              <textarea
                value={cookies}
                onChange={(e) => {
                  setCookies(e.target.value);
                  setError(null);
                }}
                placeholder={t("manualIngest.cookiesPlaceholder")}
                disabled={loading}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg 
                         bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("manualIngest.cookiesFooter")}</p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 
                         rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t("manualIngest.cancel")}
              </button>
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg 
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed 
                         transition-colors flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t("manualIngest.submitting")}
                  </>
                ) : (
                  t("manualIngest.submit")
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
