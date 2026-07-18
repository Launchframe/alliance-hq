"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type TipState = {
  code: string;
  shortPath: string;
  badgePngPath: string;
  codeHint?: string;
} | null;

export function CommanderTipJarCard() {
  const t = useTranslations("members.profile");
  const [tip, setTip] = useState<TipState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/members/me/store-tip-link");
    const body = (await res.json()) as { tip?: TipState; error?: string; code?: string };
    if (!res.ok) {
      if (body.code === "commander_not_linked" || body.code === "recipient_uid_unavailable") {
        setError(t("tipJarNeedUid"));
      } else {
        setError(body.error ?? t("tipJarNeedUid"));
      }
      setTip(null);
      return;
    }
    setError(null);
    setTip(body.tip ?? null);
  }, [t]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void refresh();
    });
    return () => cancelAnimationFrame(id);
  }, [refresh]);

  async function createOrRotate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/members/me/store-tip-link", { method: "POST" });
      const body = (await res.json()) as TipState & { error?: string; code?: string };
      if (!res.ok) {
        if (body.code === "commander_not_linked" || body.code === "recipient_uid_unavailable") {
          setError(t("tipJarNeedUid"));
        } else {
          setError(body.error ?? t("tipJarNeedUid"));
        }
        return;
      }
      setTip({
        code: body!.code!,
        shortPath: body!.shortPath!,
        badgePngPath: body!.badgePngPath!,
      });
      setConfirmRevoke(false);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await fetch("/api/members/me/store-tip-link", { method: "DELETE" });
      setTip(null);
      setConfirmRevoke(false);
    } finally {
      setBusy(false);
    }
  }

  function absoluteShortUrl(): string {
    if (!tip) return "";
    if (typeof window === "undefined") return tip.shortPath;
    return `${window.location.origin}${tip.shortPath}`;
  }

  async function copyLink() {
    const url = absoluteShortUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function downloadBadge() {
    if (!tip) return;
    const res = await fetch(tip.badgePngPath);
    if (!res.ok) return;
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `buy-me-bricks-${tip.code}.png`;
    a.click();
    URL.revokeObjectURL(href);
  }

  return (
    <section className="rounded-xl border border-sky-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950 p-5">
      <h2 className="text-lg font-semibold text-slate-50">{t("tipJarTitle")}</h2>
      <p className="mt-2 text-sm text-slate-300">{t("tipJarBody")}</p>

      {error ? (
        <p className="mt-3 text-sm text-amber-300" role="alert">
          {error}
        </p>
      ) : null}

      {tip ? (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tip.badgePngPath}
            alt={t("tipJarTitle")}
            className="mx-auto w-full max-w-[220px] rounded-2xl border border-slate-700 shadow-lg shadow-sky-950/40"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="truncate font-mono text-xs text-slate-400">
              {absoluteShortUrl()}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadBadge()}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
            >
              {t("tipJarDownloadBadge")}
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
            >
              {copied ? t("tipJarCopied") : t("tipJarCopyLink")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createOrRotate()}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
            >
              {t("tipJarRegenerate")}
            </button>
            {!confirmRevoke ? (
              <button
                type="button"
                onClick={() => setConfirmRevoke(true)}
                className="rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-950/40"
              >
                {t("tipJarRevoke")}
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke()}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                >
                  {t("tipJarRevoke")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(false)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200"
                >
                  {t("donationDialogCancel")}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void createOrRotate()}
          className="mt-4 rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
        >
          {t("tipJarCreate")}
        </button>
      )}
    </section>
  );
}
