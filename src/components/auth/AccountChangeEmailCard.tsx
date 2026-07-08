"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type Props = {
  initialEmail: string;
};

type Step = "email" | "code";

export function AccountChangeEmailCard({ initialEmail }: Props) {
  const t = useTranslations("accountSecurity");
  const { update } = useSession();
  const [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/email-change/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: newEmail.trim() }),
      });
      const body = (await res.json()) as { error?: string };
      if (res.status === 409 && body.error === "email_in_use") {
        setError(t("changeEmailInUse"));
        return;
      }
      if (res.status === 429) {
        setError(t("changeEmailRateLimited"));
        return;
      }
      if (!res.ok) {
        setError(t("changeEmailRequestFailed"));
        return;
      }
      setStep("code");
      setMessage(t("changeEmailCodeSent"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("changeEmailRequestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmChange() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/email-change/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newEmail: newEmail.trim(),
          code: code.trim(),
        }),
      });
      const body = (await res.json()) as { error?: string; email?: string };
      if (res.status === 409 && body.error === "email_in_use") {
        setError(t("changeEmailInUse"));
        return;
      }
      if (!res.ok) {
        setError(
          body.error === "invalid_code"
            ? t("changeEmailInvalidCode")
            : t("changeEmailConfirmFailed"),
        );
        return;
      }
      const nextEmail = body.email?.trim() || newEmail.trim();
      await update({ email: nextEmail });
      setEmail(nextEmail);
      setNewEmail("");
      setCode("");
      setStep("email");
      setMessage(t("changeEmailSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("changeEmailConfirmFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("changeEmailTitle")}</h2>
      <p className="text-sm text-hq-fg-muted">{t("changeEmailBody")}</p>
      <p className="text-sm">
        <span className="text-hq-fg-muted">{t("changeEmailCurrentLabel")}</span>{" "}
        <span className="font-medium text-hq-fg">{email}</span>
      </p>

      {step === "email" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void requestCode();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("changeEmailNewLabel")}</span>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
              autoComplete="email"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newEmail.trim()}
            className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? t("saving") : t("changeEmailSendCode")}
          </button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void confirmChange();
          }}
        >
          <p className="text-sm text-hq-fg-muted">
            {t("changeEmailCodePrompt", { email: newEmail.trim() })}
          </p>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("changeEmailCodeLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono tracking-widest"
              autoComplete="one-time-code"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? t("saving") : t("changeEmailConfirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setMessage(null);
              }}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg disabled:opacity-50"
            >
              {t("changeEmailBack")}
            </button>
          </div>
        </form>
      )}

      {message ? <p className="text-sm text-hq-green">{message}</p> : null}
      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
    </section>
  );
}
