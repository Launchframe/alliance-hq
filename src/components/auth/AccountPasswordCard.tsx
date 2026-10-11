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
  const [currentPassword, setCurrentPassword] = useState("");
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
    if (hasPassword && !currentPassword.trim()) {
      setError(t("currentPasswordRequired"));
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/password/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          confirmPassword,
          ...(hasPassword ? { currentPassword } : {}),
        }),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: string };
          code = data.error ?? null;
        } catch {
          code = null;
        }
        if (code === "current_password_incorrect") {
          setError(t("currentPasswordIncorrect"));
        } else if (code === "current_password_required") {
          setError(t("currentPasswordRequired"));
        } else {
          setError(t("setPasswordFailed"));
        }
        return;
      }
      setCurrentPassword("");
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
    <section className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("passwordSectionTitle")}</h2>
      <p className="text-sm text-hq-fg-muted">
        {hasPassword ? t("passwordSectionBodySet") : t("passwordSectionBodyUnset")}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void savePassword();
        }}
      >
        {hasPassword ? (
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("currentPassword")}</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
              autoComplete="current-password"
            />
          </label>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("newPassword")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("confirmPassword")}</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? t("saving") : hasPassword ? t("updatePassword") : t("setPassword")}
        </button>
      </form>
      {message ? <p className="text-sm text-hq-green">{message}</p> : null}
      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
    </section>
  );
}
