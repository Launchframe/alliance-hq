"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import type { PairingPurpose } from "@/lib/credential-pairing/types";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

type Props = {
  code: string;
};

type CompleteResponse = {
  ok?: boolean;
  purpose?: PairingPurpose;
  error?: string;
  code?: string;
};

type PreviewResponse = {
  status: "pending" | "linked" | "expired" | "invalid";
  purpose?: PairingPurpose;
  ownerDisplayName?: string | null;
};

export function PairingLandingClient({ code }: Props) {
  const t = useTranslations("deviceLink.landing");
  const tShare = useTranslations("credentialShare.accept");
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready" | "linking" | "success" | "error">(
    code ? "loading" : "error",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ownerDisplayName, setOwnerDisplayName] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!code) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/auth/pairing/preview?code=${encodeURIComponent(code)}`,
        );
        const data = (await res.json()) as PreviewResponse;
        if (data.status !== "pending") {
          setErrorMessage(t("failed"));
          setPhase("error");
          return;
        }
        if (data.purpose === "authorized_access") {
          setOwnerDisplayName(data.ownerDisplayName ?? null);
          setPhase("ready");
          return;
        }
        void completePairing(false);
      } catch {
        setErrorMessage(t("failed"));
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function completePairing(withAck: boolean) {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("linking");
    try {
      const res = await fetch("/api/auth/pairing/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, acknowledged: withAck }),
      });
      const data = (await res.json()) as CompleteResponse;

      if (!res.ok) {
        setErrorMessage(data.error ?? t("failed"));
        setPhase("error");
        startedRef.current = false;
        return;
      }

      setPhase("success");
    } catch {
      setErrorMessage(t("failed"));
      setPhase("error");
      startedRef.current = false;
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-md space-y-4 text-center">
      <h1 className="text-xl font-semibold text-hq-fg">
        {phase === "ready" ? tShare("title") : t("title")}
      </h1>

      {phase === "loading" ? (
        <p className="text-sm text-hq-fg-muted">{t("linking")}</p>
      ) : null}

      {phase === "linking" ? (
        <p className="text-sm text-hq-fg-muted">{tShare("submitting")}</p>
      ) : null}

      {phase === "ready" ? (
        <form
          className="space-y-4 text-left"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            if (!acknowledged) {
              setErrorMessage(tShare("ackRequired"));
              return;
            }
            void completePairing(true);
          }}
        >
          <p className="text-sm text-hq-fg-muted">
            {tShare("body", {
              owner: ownerDisplayName ?? tShare("unknownOwner"),
            })}
          </p>
          <label className="flex items-start gap-2 text-sm text-hq-fg-muted">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>{tShare("acknowledgment")}</span>
          </label>
          {errorMessage ? (
            <p className="text-sm text-red-400">{errorMessage}</p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white"
          >
            {tShare("acceptCta")}
          </button>
        </form>
      ) : null}

      {phase === "success" ? (
        <div className="space-y-4">
          <p className="text-sm text-hq-green">
            {ownerDisplayName ? tShare("success") : t("success")}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover sm:w-auto"
          >
            {t("continue")}
          </button>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{errorMessage ?? t("failed")}</p>
          <p className="text-sm text-hq-fg-muted">{t("retryHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
