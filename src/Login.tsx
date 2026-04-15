import { FormEvent, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth/AuthContext";
import { LanguageSwitcher } from "./components/LanguageSwitcher.tsx";

type Step = "password" | "otp";

export default function Login({ onLoginSuccess }: { onLoginSuccess?: () => void }) {
  const { t } = useTranslation();
  const { login, completeLoginWithOtp, resendLoginOtp, loading, user } = useAuth();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [emailMasked, setEmailMasked] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const [legacyAgentId, setLegacyAgentId] = useState(() => {
    try {
      return localStorage.getItem("agentId") || "";
    } catch (e) {
      console.warn("[Login] Failed to read agentId from localStorage", e);
      return "";
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginSuccessHandled, setLoginSuccessHandled] = useState(false);

  useEffect(() => {
    if (user && !submitting && !loginSuccessHandled && onLoginSuccess) {
      setLoginSuccessHandled(true);
      onLoginSuccess();
    }
  }, [user, submitting, loginSuccessHandled, onLoginSuccess]);

  useEffect(() => {
    if (!submitting && error) {
      setLoginSuccessHandled(false);
    }
  }, [submitting, error]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setInterval(() => {
      setResendCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [resendCooldown]);

  const saveLegacyAgentId = () => {
    try {
      if (legacyAgentId.trim()) {
        localStorage.setItem("agentId", legacyAgentId.trim());
      } else {
        localStorage.removeItem("agentId");
      }
    } catch (e) {
      console.warn("[Login] Failed to save agentId to localStorage", e);
    }
  };

  const goBackToPassword = () => {
    setStep("password");
    setChallengeId(null);
    setOtpCode("");
    setEmailMasked("");
    setError(null);
    setResendCooldown(0);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (step === "otp") {
        const digits = otpCode.replace(/\D/g, "").slice(0, 6);
        if (digits.length !== 6) {
          setError(t("login.errorOtpLength"));
          setSubmitting(false);
          return;
        }
        if (!challengeId) {
          setError(t("login.errorSessionExpired"));
          setSubmitting(false);
          return;
        }
        await completeLoginWithOtp(challengeId, digits);
        saveLegacyAgentId();
        setSubmitting(false);
        return;
      }

      const result = await login(email.trim(), password);

      if (result && "requiresOtp" in result && result.requiresOtp) {
        setChallengeId(result.loginChallengeId);
        setEmailMasked(result.emailMasked);
        setStep("otp");
        setOtpCode("");
        setResendCooldown(60);
        setSubmitting(false);
        return;
      }

      saveLegacyAgentId();
      setSubmitting(false);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("login.errorUnknown"));
      }
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!challengeId || resendCooldown > 0) return;
    setError(null);
    try {
      await resendLoginOtp(challengeId);
      setResendCooldown(60);
    } catch (err) {
      if (err instanceof Error) {
        const withRetry = err as Error & { retryAfterSeconds?: number };
        if (typeof withRetry.retryAfterSeconds === "number" && withRetry.retryAfterSeconds > 0) {
          setResendCooldown(withRetry.retryAfterSeconds);
        }
        setError(err.message);
      } else {
        setError(t("login.errorResend"));
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md border border-slate-100">
        <div className="mb-8 text-center space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-500">AIMGLOBAL</p>
          <h1 className="text-3xl font-bold text-slate-900">
            {step === "otp" ? t("login.titleOtp") : t("login.titleSignIn")}
          </h1>
          <p className="text-sm text-slate-500">
            {step === "otp"
              ? t("login.subtitleOtp", { email: emailMasked })
              : t("login.subtitlePassword")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {step === "password" && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-600">{t("login.email")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  placeholder={t("login.emailPlaceholder")}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-600">{t("login.password")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  placeholder="********"
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-600">{t("login.agentIdOptional")}</label>
                  <span className="text-xs text-slate-400">{t("login.agentIdHint")}</span>
                </div>
                <input
                  type="text"
                  value={legacyAgentId}
                  onChange={(event) => setLegacyAgentId(event.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                  placeholder={t("login.agentIdPlaceholder")}
                />
              </div>
            </>
          )}

          {step === "otp" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-600">{t("login.otpLabel")}</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white tracking-widest text-center text-lg font-mono"
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
              />
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={goBackToPassword}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  {t("login.backToPassword")}
                </button>
                <button
                  type="button"
                  disabled={resendCooldown > 0}
                  onClick={handleResend}
                  className="text-sm text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0
                    ? t("login.resendIn", { seconds: resendCooldown })
                    : t("login.resend")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-medium transition disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {submitting
              ? step === "otp"
                ? t("login.submittingVerify")
                : t("login.submittingSignIn")
              : step === "otp"
                ? t("login.submitVerify")
                : t("login.submitSignIn")}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-slate-400 space-y-1">
          <a className="text-blue-600 hover:text-blue-700" href="/">
            {t("login.backToDashboard")}
          </a>
        </div>
      </div>
    </div>
  );
}
