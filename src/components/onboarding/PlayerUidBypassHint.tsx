"use client";

import { useTranslations } from "next-intl";

import { isUidBypassEnabled } from "@/lib/dev/env-guard";
import {
  PLAYER_UID_BYPASS_ENTRIES,
} from "@/lib/lastwar/player-lookup-bypass.shared";

type Props = {
  onSelectUid?: (uid: string) => void;
};

export function PlayerUidBypassHint({ onSelectUid }: Props) {
  const t = useTranslations("onboard.uidBypass");

  if (!isUidBypassEnabled()) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[#d29922]/30 bg-[#d29922]/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-[#e3b341]">{t("title")}</p>
        <span className="rounded-full border border-[#d29922]/40 bg-[#d29922]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#e3b341]">
          {t("badge")}
        </span>
      </div>
      <p className="mt-1 text-xs text-hq-fg-muted">{t("body")}</p>
      <ul className="mt-3 space-y-2">
        {PLAYER_UID_BYPASS_ENTRIES.map((entry) => (
          <li key={entry.uid} className="text-xs">
            <button
              type="button"
              onClick={() => onSelectUid?.(entry.uid)}
              className="group w-full rounded-md border border-hq-border/70 bg-hq-canvas/80 px-3 py-2 text-left hover:border-hq-accent/50 hover:bg-hq-surface"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <code className="font-mono text-[11px] text-hq-fg group-hover:text-hq-accent">
                  {entry.uid}
                </code>
                <span className="text-hq-fg-muted">
                  → {entry.gameUserName} (S{entry.gameServerNumber})
                </span>
              </div>
              <p className="mt-1 text-hq-fg-muted">
                {t(`entries.${entry.descriptionKey}`)}
              </p>
            </button>
          </li>
        ))}
        <li className="rounded-md border border-hq-border/70 bg-hq-canvas/80 px-3 py-2 text-xs">
          <code className="font-mono text-[11px] text-hq-fg">
            1234567890####
          </code>
          <p className="mt-1 text-hq-fg-muted">{t("entries.ownerPattern")}</p>
          <p className="mt-1 text-hq-fg-muted">
            {t("ownerPatternExample", { uid: "12345678901847", server: 1847 })}
          </p>
          {onSelectUid ? (
            <button
              type="button"
              onClick={() => onSelectUid("12345678901847")}
              className="mt-2 text-[11px] font-medium text-hq-accent hover:underline"
            >
              {t("useExampleUid")}
            </button>
          ) : null}
        </li>
      </ul>
    </div>
  );
}
