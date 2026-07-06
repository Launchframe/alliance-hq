"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { signIn as signInWithWebAuthn } from "next-auth/webauthn";
import { useEffect, useState } from "react";

import { AuthMethodPickerRow } from "@/components/auth/AuthMethodPicker";
import { SegmentedCodeInput } from "@/components/ui/SegmentedCodeInput";

import { Link } from "@/i18n/navigation";
import { FORM_SUBMIT_ENTER_KEY_HINT } from "@/lib/client/form-enter-submit.shared";
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
  type PasswordValidationCode,
} from "@/lib/auth/password.shared";
import type { AuthSsoAvailability } from "@/lib/auth/sso-config.shared";
import { mapAuthSignInErrorCode } from "@/lib/auth/auth-sign-in-errors.shared";

type Props = {
  callbackUrl?: string;
  presetEmail?: string;
  authError?: string;
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
  authError,
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
  const authErrorKey = mapAuthSignInErrorCode(authError);

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

      {authErrorKey && step === "picker" ? (
        <div
          className="space-y-2 rounded-lg border border-[#f85149]/40 bg-[#f85149]/10 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm font-medium text-[#e6edf3]">
            {authErrorKey === "errorOAuthAccountNotLinked"
              ? t("errorOAuthAccountNotLinkedTitle")
              : t(authErrorKey)}
          </p>
          {authErrorKey === "errorOAuthAccountNotLinked" ? (
            <>
              <p className="text-sm text-[#8b949e]">
                {t("errorOAuthAccountNotLinkedBody")}
              </p>
              <Link
                href="/settings/account"
                className="inline-block text-sm text-[#58a6ff] hover:underline"
              >
                {t("errorOAuthAccountNotLinkedAccountLink")}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

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
        <AuthMethodPickerRow
          ssoAvailability={ssoAvailability}
          disabled={submitting}
          ariaLabel={t("methodPickerLabel")}
          labels={{
            google: t("methodGoogle"),
            discord: t("methodDiscord"),
            passkey: t("methodPasskey"),
            email: t("methodEmail"),
          }}
          onGoogleClick={() => void signInWithOAuth("google")}
          onDiscordClick={() => void signInWithOAuth("discord")}
          onPasskeyClick={() => void signInWithPasskey()}
          onEmailClick={() => goToEmailStep("email-sign-in")}
        />
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
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
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
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
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
              enterKeyHint={codeSent ? undefined : FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 read-only:opacity-80"
              autoComplete="email"
              autoFocus={!codeSent}
            />
          </label>

          {codeSent ? (
            <div className="space-y-2">
              <label
                htmlFor="email-verification-code"
                className="block text-sm text-[#8b949e]"
              >
                {t("verificationCode")}
              </label>
              <SegmentedCodeInput
                id="email-verification-code"
                format="fixed"
                length={6}
                charset="numeric"
                value={verificationCode}
                onChange={setVerificationCode}
                onSubmit={() => void verifyEmailCode()}
                autoComplete="one-time-code"
                aria-label={t("verificationCode")}
                autoFocus
              />
            </div>
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
