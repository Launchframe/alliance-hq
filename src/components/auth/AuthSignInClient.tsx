"use client";

import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { signIn as signInWithWebAuthn } from "next-auth/webauthn";
import { useEffect, useState } from "react";

import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
  type PasswordValidationCode,
} from "@/lib/auth/password.shared";
import type { AuthSsoAvailability } from "@/lib/auth/sso-config.shared";

type Props = {
  callbackUrl?: string;
  presetEmail?: string;
  ssoAvailability: AuthSsoAvailability;
};

type AuthStep = "picker" | "email-sign-in" | "email-magic" | "email-verify-code";

function passwordErrorMessage(
  t: ReturnType<typeof useTranslations<"auth">>,
  code: PasswordValidationCode,
): string {
  switch (code) {
    case "required":
      return t("passwordRequired");
    case "too_short":
      return t("passwordTooShort", { min: MIN_PASSWORD_LENGTH });
    case "too_long":
      return t("passwordTooLong");
    case "mismatch":
      return t("passwordMismatch");
    default:
      return t("passwordInvalid");
  }
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function MethodPickerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-w-[4.75rem] flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] px-2 py-3 text-xs font-medium text-[#e6edf3] transition-colors hover:border-[#484f58] hover:bg-[#161b22] disabled:opacity-50"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function BackToPickerButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex items-center gap-1 self-start text-xs text-[#8b949e] transition-colors hover:text-[#e6edf3]"
    >
      <ArrowLeft className="h-3 w-3" aria-hidden />
      {label}
    </button>
  );
}

export function AuthSignInClient({
  callbackUrl,
  presetEmail,
  ssoAvailability,
}: Props) {
  const t = useTranslations("auth");
  const [step, setStep] = useState<AuthStep>("picker");
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTarget = callbackUrl ?? "/get-started";

  const textLinkClass =
    "text-sm text-[#58a6ff] hover:underline disabled:opacity-50";

  function resetToPicker() {
    setStep("picker");
    setError(null);
    setPassword("");
    setVerificationCode("");
    setCodeSent(false);
  }

  function goToEmailStep(next: Exclude<AuthStep, "picker">) {
    setStep(next);
    setError(null);
    if (next !== "email-verify-code") {
      setVerificationCode("");
      setCodeSent(false);
    }
  }

  useEffect(() => {
    if (codeCooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCodeCooldown((value) => value - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  async function signInWithOAuth(provider: "google" | "discord") {
    setSubmitting(true);
    setError(null);
    try {
      await signIn(provider, { callbackUrl: redirectTarget });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
      setSubmitting(false);
    }
  }

  async function sendMagicLink() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("emailRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("resend", {
        email: trimmed,
        redirect: false,
        callbackUrl: redirectTarget,
      });
      if (result?.error) {
        setError(t("sendFailed"));
        return;
      }
      const params = new URLSearchParams({ email: trimmed });
      if (callbackUrl) {
        params.set("callbackUrl", callbackUrl);
      }
      window.location.href = `/auth/check-email?${params.toString()}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sendFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function signInWithPassword() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("emailRequired"));
      return;
    }

    const validation = validatePasswordPair({ password });
    if (validation) {
      setError(passwordErrorMessage(t, validation));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("password", {
        email: trimmed,
        password,
        redirect: false,
        callbackUrl: redirectTarget,
      });
      if (result?.error || !result?.ok) {
        setError(t("invalidCredentials"));
        return;
      }
      window.location.href = redirectTarget;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("invalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendVerificationCode() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("emailRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.status === 429) {
        setError(t("codeRateLimited"));
        return;
      }
      if (!res.ok) {
        setError(t("sendCodeFailed"));
        return;
      }
      setCodeSent(true);
      setVerificationCode("");
      setCodeCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sendCodeFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyEmailCode() {
    const trimmed = email.trim();
    const code = verificationCode.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("emailRequired"));
      return;
    }
    if (!/^[0-9]{6}$/.test(code)) {
      setError(t("codeInvalid"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("email-code", {
        email: trimmed,
        code,
        redirect: false,
        callbackUrl: redirectTarget,
      });
      if (result?.error || !result?.ok) {
        setError(t("codeVerifyFailed"));
        return;
      }
      window.location.href = redirectTarget;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("codeVerifyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function signInWithPasskey() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await signInWithWebAuthn("passkey", {
        redirect: false,
        callbackUrl: redirectTarget,
      });
      if (result?.error) {
        setError(t("passkeyFailed"));
        return;
      }
      if (result?.url) {
        window.location.href = result.url;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("passkeyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signInWithPassword();
  }

  function handleVerifyCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codeSent) {
      void verifyEmailCode();
      return;
    }
    void sendVerificationCode();
  }

  function handleMagicLinkSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMagicLink();
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">{t("subtitle")}</p>

      {error && step === "picker" ? (
        <p className="text-sm text-[#f85149]">{error}</p>
      ) : null}

      {step === "picker" && ssoAvailability.discord ? (
        <p
          className="rounded-lg border border-[#5865F2]/35 bg-[#5865F2]/10 px-3 py-2.5 text-sm leading-snug text-[#e6edf3]"
          role="note"
        >
          {t("discordSignInHint")}
        </p>
      ) : null}

      {step === "picker" ? (
        <div
          className="flex flex-wrap justify-center gap-2"
          role="group"
          aria-label={t("methodPickerLabel")}
        >
          {ssoAvailability.google ? (
            <MethodPickerButton
              label={t("methodGoogle")}
              disabled={submitting}
              onClick={() => void signInWithOAuth("google")}
            >
              <GoogleIcon />
            </MethodPickerButton>
          ) : null}
          {ssoAvailability.discord ? (
            <MethodPickerButton
              label={t("methodDiscord")}
              disabled={submitting}
              onClick={() => void signInWithOAuth("discord")}
            >
              <DiscordIcon />
            </MethodPickerButton>
          ) : null}
          <MethodPickerButton
            label={t("methodPasskey")}
            disabled={submitting}
            onClick={() => void signInWithPasskey()}
          >
            <KeyRound className="h-5 w-5 text-[#8b949e]" aria-hidden />
          </MethodPickerButton>
          <MethodPickerButton
            label={t("methodEmail")}
            disabled={submitting}
            onClick={() => goToEmailStep("email-sign-in")}
          >
            <Mail className="h-5 w-5 text-[#8b949e]" aria-hidden />
          </MethodPickerButton>
        </div>
      ) : null}

      {step === "email-sign-in" ? (
        <form className="space-y-4" onSubmit={handlePasswordSubmit}>
          <BackToPickerButton label={t("backToAllOptions")} onClick={resetToPicker} />

          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("email")}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              autoComplete="email"
              autoFocus
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("password")}</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              autoComplete="current-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
          </label>

          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? t("signingIn") : t("signInWithPassword")}
          </button>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${textLinkClass} text-left`}
              onClick={() => goToEmailStep("email-verify-code")}
            >
              {t("createAccount")}
            </button>
            <button
              type="button"
              className={`${textLinkClass} text-left`}
              onClick={() => goToEmailStep("email-magic")}
            >
              {t("emailHelpLink")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "email-magic" ? (
        <form className="space-y-4" onSubmit={handleMagicLinkSubmit}>
          <BackToPickerButton label={t("backToAllOptions")} onClick={resetToPicker} />
          <p className="text-sm text-[#8b949e]">{t("magicLinkBody")}</p>

          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("email")}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              autoComplete="email"
              autoFocus
            />
          </label>

          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? t("sending") : t("sendLink")}
          </button>

          <p className="text-xs text-[#6e7681]">{t("magicLinkHint")}</p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${textLinkClass} text-left`}
              onClick={() => goToEmailStep("email-verify-code")}
            >
              {t("verifyWithCodeLink")}
            </button>
            <button
              type="button"
              className={`${textLinkClass} text-left`}
              onClick={() => goToEmailStep("email-sign-in")}
            >
              {t("backToSignIn")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "email-verify-code" ? (
        <form className="space-y-4" onSubmit={handleVerifyCodeSubmit}>
          <BackToPickerButton label={t("backToAllOptions")} onClick={resetToPicker} />
          <p className="text-sm text-[#8b949e]">{t("verifyCodeBody")}</p>

          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("email")}</span>
            <input
              type="email"
              required
              readOnly={codeSent}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 read-only:opacity-80"
              autoComplete="email"
              autoFocus={!codeSent}
            />
          </label>

          {codeSent ? (
            <label className="block space-y-1 text-sm">
              <span className="text-[#8b949e]">{t("verificationCode")}</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono tracking-[0.35em]"
                autoFocus
              />
            </label>
          ) : null}

          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting
              ? t("signingIn")
              : codeSent
                ? t("verifyCode")
                : t("sendCode")}
          </button>

          {codeSent ? (
            <button
              type="button"
              disabled={submitting || codeCooldown > 0}
              className={`${textLinkClass} text-left`}
              onClick={() => void sendVerificationCode()}
            >
              {codeCooldown > 0
                ? t("resendCodeCooldown", { seconds: codeCooldown })
                : t("resendCode")}
            </button>
          ) : null}

          <p className="text-xs text-[#6e7681]">{t("verifyCodeHint")}</p>

          <button
            type="button"
            className={`${textLinkClass} text-left`}
            onClick={() => goToEmailStep("email-magic")}
          >
            {t("magicLinkInstead")}
          </button>
        </form>
      ) : null}
      <p className="text-xs text-[#6e7681]">{t("signupHint")}</p>
    </div>
  );
}
