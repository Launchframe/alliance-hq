"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { StoreTipCardShell } from "@/components/members/StoreTipCardShell";
import { publicStoreTipLaunchPath } from "@/lib/members/store-tip-launch.shared";

type Props = {
  code: string;
  displayName: string;
  allianceTag: string | null;
  autoOpen: boolean;
  /** Set when `/launch` redirected back after a failure. */
  launchFailed?: boolean;
};

export function StoreTipPublicClient({
  code,
  displayName,
  allianceTag,
  autoOpen,
  launchFailed = false,
}: Props) {
  const t = useTranslations("storeTipPublic");
  const [error, setError] = useState<string | null>(
    launchFailed ? t("tipPublicUnavailable") : null,
  );
  const opened = useRef(false);

  function openStore(options?: { sameTab?: boolean }) {
    setError(null);
    const launchUrl = publicStoreTipLaunchPath(code);
    // Navigate the launch route itself — never fetch JSON `{ url }` (would
    // put loginToken + uid into JS / network response bodies).
    if (options?.sameTab) {
      window.location.assign(launchUrl);
      return;
    }
    const popup = window.open(launchUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      setError(t("tipPublicUnavailable"));
    }
  }

  useEffect(() => {
    if (!autoOpen || opened.current || launchFailed) return;
    opened.current = true;
    const id = requestAnimationFrame(() => {
      openStore({ sameTab: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on mount
  }, [autoOpen, launchFailed]);

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
        onClick={() => openStore()}
        className="mt-8 w-full rounded-xl bg-gradient-to-r from-sky-500 to-amber-400 px-4 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-sky-900/30 transition hover:brightness-110"
      >
        {t("tipPublicOpenStore")}
      </button>
    </StoreTipCardShell>
  );
}
