"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { StoreTipCardShell } from "@/components/members/StoreTipCardShell";

type Props = {
  code: string;
  displayName: string;
  allianceTag: string | null;
  autoOpen: boolean;
};

export function StoreTipPublicClient({
  code,
  displayName,
  allianceTag,
  autoOpen,
}: Props) {
  const t = useTranslations("storeTipPublic");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);

  async function openStore(options?: { sameTab?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/public/store-tip/${encodeURIComponent(code)}/launch`,
      );
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? t("tipPublicUnavailable"));
        return;
      }
      // QR `?go=1` auto-open is not a user gesture — same-tab avoids popup blockers.
      if (options?.sameTab) {
        window.location.assign(body.url);
        return;
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch {
      setError(t("tipPublicUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    const id = requestAnimationFrame(() => {
      void openStore({ sameTab: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on mount
  }, [autoOpen]);

  return (
    <StoreTipCardShell>
      <h1 className="mt-4 text-2xl font-semibold text-slate-50 sm:text-3xl">
        {t("tipPublicTitle", { name: displayName })}
      </h1>
      {allianceTag ? (
        <p className="mt-2 text-sm font-medium text-sky-300/90">[{allianceTag}]</p>
      ) : null}
      <p className="mt-4 text-sm leading-relaxed text-slate-300">
        {t("tipPublicBody")}
      </p>
      {error ? (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        autoFocus
        disabled={busy}
        onClick={() => void openStore()}
        className="mt-8 w-full rounded-xl bg-gradient-to-r from-sky-500 to-amber-400 px-4 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-sky-900/30 transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? "…" : t("tipPublicOpenStore")}
      </button>
    </StoreTipCardShell>
  );
}
