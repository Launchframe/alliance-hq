"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
  type PasswordValidationCode,
} from "@/lib/auth/password.shared";

type Props = {
  hasPassword: boolean;
  passkeyCount: number;
};

function passwordErrorMessage(
  t: ReturnType<typeof useTranslations<"accountSecurity">>,
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

export function AccountSecurityClient({ hasPassword, passkeyCount }: Props) {
  const t = useTranslations("accountSecurity");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePassword() {
    const validation = validatePasswordPair({ password, confirmPassword });
    if (validation) {
      setError(passwordErrorMessage(t, validation));
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/password/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword }),
      });
      if (!res.ok) {
        setError(t("setPasswordFailed"));
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setMessage(t("setPasswordSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("setPasswordFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function registerPasskey() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await signIn("passkey", {
        action: "register",
        redirect: false,
      });
      if (result?.error) {
        setError(t("registerPasskeyFailed"));
        return;
      }
      setMessage(t("registerPasskeySuccess"));
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("registerPasskeyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("passwordSectionTitle")}</h2>
        <p className="text-sm text-[#8b949e]">
          {hasPassword ? t("passwordSectionBodySet") : t("passwordSectionBodyUnset")}
        </p>
        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("newPassword")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("confirmPassword")}</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void savePassword()}
          className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? t("saving") : hasPassword ? t("updatePassword") : t("setPassword")}
        </button>
      </section>

      <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("passkeySectionTitle")}</h2>
        <p className="text-sm text-[#8b949e]">
          {passkeyCount > 0
            ? t("passkeySectionBodyCount", { count: passkeyCount })
            : t("passkeySectionBodyNone")}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void registerPasskey()}
          className="rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-sm text-[#e6edf3] hover:border-[#58a6ff] disabled:opacity-50"
        >
          {busy ? t("saving") : t("addPasskey")}
        </button>
      </section>

      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
    </div>
  );
}
