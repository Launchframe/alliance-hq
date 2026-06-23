"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
  type PasswordValidationCode,
} from "@/lib/auth/password.shared";

type Props = {
  callbackUrl?: string;
  presetEmail?: string;
};

type AuthMethod = "password" | "magic-link" | "passkey";

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

export function AuthSignInClient({ callbackUrl, presetEmail }: Props) {
  const t = useTranslations("auth");
  const [method, setMethod] = useState<AuthMethod>("password");
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTarget = callbackUrl ?? "/get-started";

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

  async function signInWithPasskey() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("passkey", {
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

  function handleMagicLinkSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMagicLink();
  }

  const methodTabClass = (active: boolean) =>
    [
      "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-[#238636] text-white"
        : "border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]",
    ].join(" ");

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">{t("subtitle")}</p>

      <div className="flex gap-2" role="tablist" aria-label={t("methodTabsLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={method === "password"}
          className={methodTabClass(method === "password")}
          onClick={() => {
            setMethod("password");
            setError(null);
          }}
        >
          {t("methodPassword")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "passkey"}
          className={methodTabClass(method === "passkey")}
          onClick={() => {
            setMethod("passkey");
            setError(null);
          }}
        >
          {t("methodPasskey")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "magic-link"}
          className={methodTabClass(method === "magic-link")}
          onClick={() => {
            setMethod("magic-link");
            setError(null);
          }}
        >
          {t("methodMagicLink")}
        </button>
      </div>

      {method === "password" ? (
        <form className="space-y-4" onSubmit={handlePasswordSubmit}>
          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("email")}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              autoComplete="email"
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

          <p className="text-xs text-[#6e7681]">{t("passwordHint")}</p>
        </form>
      ) : null}

      {method === "magic-link" ? (
        <form className="space-y-4" onSubmit={handleMagicLinkSubmit}>
          <label className="block space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("email")}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              autoComplete="email"
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
        </form>
      ) : null}

      {method === "passkey" ? (
        <div className="space-y-4">
          <p className="text-sm text-[#8b949e]">{t("passkeyBody")}</p>
          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
          <button
            type="button"
            disabled={submitting}
            onClick={() => void signInWithPasskey()}
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? t("signingIn") : t("signInWithPasskey")}
          </button>
          <p className="text-xs text-[#6e7681]">{t("passkeyHint")}</p>
        </div>
      ) : null}

      <p className="text-xs text-[#6e7681]">{t("signupHint")}</p>

      <Link href="/" className="inline-block text-sm text-[#58a6ff] hover:underline">
        {t("home")}
      </Link>
    </div>
  );
}
