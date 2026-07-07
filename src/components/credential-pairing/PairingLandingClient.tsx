"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import type { PairingPurpose } from "@/lib/credential-pairing/types";

type Props = {
  code: string;
};

type CompleteResponse = {
  ok?: boolean;
  purpose?: PairingPurpose;
  error?: string;
  code?: string;
};

export function PairingLandingClient({ code }: Props) {
  const t = useTranslations("deviceLink.landing");
  const router = useRouter();
  const [phase, setPhase] = useState<"linking" | "success" | "error">(
    "linking",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!code || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/auth/pairing/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = (await res.json()) as CompleteResponse;

        if (!res.ok) {
          setErrorMessage(data.error ?? t("failed"));
          setPhase("error");
          return;
        }

        setPhase("success");
      } catch {
        setErrorMessage(t("failed"));
        setPhase("error");
      }
    })();
  }, [code, t]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-md space-y-4 text-center">
      <h1 className="text-xl font-semibold text-hq-fg">{t("title")}</h1>

      {phase === "linking" ? (
        <p className="text-sm text-hq-fg-muted">{t("linking")}</p>
      ) : null}

      {phase === "success" ? (
        <div className="space-y-4">
          <p className="text-sm text-hq-green">{t("success")}</p>
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
