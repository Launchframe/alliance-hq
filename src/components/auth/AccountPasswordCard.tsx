"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
  type PasswordValidationCode,
} from "@/lib/auth/password.shared";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type Props = {
  hasPassword: boolean;
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

export function AccountPasswordCard({ hasPassword: initialHasPassword }: Props) {
  const t = useTranslations("accountSecurity");
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
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
      setHasPassword(true);
      setMessage(t("setPasswordSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("setPasswordFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="font-medium">{t("passwordSectionTitle")}</h2>
      <p className="text-sm text-[#8b949e]">
        {hasPassword ? t("passwordSectionBodySet") : t("passwordSectionBodyUnset")}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void savePassword();
        }}
      >
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
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? t("saving") : hasPassword ? t("updatePassword") : t("setPassword")}
        </button>
      </form>
      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
    </section>
  );
}
