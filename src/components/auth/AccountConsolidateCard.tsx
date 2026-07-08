"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type PreviewAlliance = {
  allianceId: string;
  allianceName: string;
  allianceTag: string | null;
  commanderNames: string[];
};

type Step = "email" | "code" | "review";

function mergeErrorMessage(
  code: string | undefined,
  t: ReturnType<typeof useTranslations<"accountSecurity">>,
): string {
  switch (code) {
    case "source_not_found":
      return t("consolidateSourceNotFound");
    case "same_account":
      return t("consolidateSameAccount");
    case "commander_conflict":
      return t("consolidateCommanderConflict");
    case "discord_conflict":
      return t("consolidateDiscordConflict");
    case "ashed_identity_conflict":
      return t("consolidateAshedConflict");
    case "platform_maintainer":
      return t("consolidateMaintainerBlocked");
    case "nothing_to_merge":
      return t("consolidateNothingToMerge");
    case "invalid_code":
    case "not_found":
      return t("consolidateInvalidCode");
    case "rate_limited":
      return t("consolidateRateLimited");
    default:
      return t("consolidateRequestFailed");
  }
}

export function AccountConsolidateCard() {
  const t = useTranslations("accountSecurity");
  const [sourceEmail, setSourceEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [preview, setPreview] = useState<PreviewAlliance[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestProof() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setPreview(null);
    try {
      const res = await fetch("/api/user/account-merge/request-source-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEmail: sourceEmail.trim() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(mergeErrorMessage(body.error, t));
        return;
      }
      setStep("code");
      setMessage(t("consolidateProofSent"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("consolidateRequestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user/account-merge/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEmail: sourceEmail.trim(),
          code: code.trim(),
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        preview?: { alliances: PreviewAlliance[] };
      };
      if (!res.ok) {
        setError(mergeErrorMessage(body.error, t));
        return;
      }
      setPreview(body.preview?.alliances ?? []);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("consolidatePreviewFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMerge() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/account-merge/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEmail: sourceEmail.trim(),
          code: code.trim(),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(mergeErrorMessage(body.error, t));
        return;
      }
      setSourceEmail("");
      setCode("");
      setPreview(null);
      setStep("email");
      setMessage(t("consolidateSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("consolidateConfirmFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("consolidateTitle")}</h2>
      <p className="text-sm text-hq-fg-muted">{t("consolidateBody")}</p>

      {step === "email" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void requestProof();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">
              {t("consolidateSourceEmailLabel")}
            </span>
            <input
              type="email"
              required
              value={sourceEmail}
              onChange={(e) => setSourceEmail(e.target.value)}
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
              autoComplete="email"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !sourceEmail.trim()}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg disabled:opacity-50"
          >
            {busy ? t("saving") : t("consolidateSendCode")}
          </button>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void loadPreview();
          }}
        >
          <p className="text-sm text-hq-fg-muted">
            {t("consolidateCodePrompt", { email: sourceEmail.trim() })}
          </p>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("consolidateCodeLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
              className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-mono tracking-widest"
              autoComplete="one-time-code"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg disabled:opacity-50"
            >
              {busy ? t("saving") : t("consolidateReview")}
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
              {t("consolidateBack")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <h3 className="text-sm font-medium">{t("consolidateReviewTitle")}</h3>
          {preview && preview.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {preview.map((alliance) => (
                <li
                  key={alliance.allianceId}
                  className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
                >
                  <p className="font-medium text-hq-fg">
                    {alliance.allianceName}
                    {alliance.allianceTag ? ` [${alliance.allianceTag}]` : ""}
                  </p>
                  {alliance.commanderNames.length > 0 ? (
                    <p className="text-hq-fg-muted">
                      {t("consolidateCommanders", {
                        names: alliance.commanderNames.join(", "),
                      })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-hq-fg-muted">{t("consolidateReviewEmpty")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmMerge()}
              className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? t("saving") : t("consolidateConfirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep("code");
                setError(null);
              }}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg disabled:opacity-50"
            >
              {t("consolidateBack")}
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="text-sm text-hq-green">{message}</p> : null}
      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
    </section>
  );
}
