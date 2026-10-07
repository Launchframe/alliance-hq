"use client";

import { useTranslations } from "next-intl";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { GameDataSyncStatus } from "@/lib/lastrank/sync-registry.shared";

export function GameDataSyncCard({ status }: { status: GameDataSyncStatus }) {
  const t = useTranslations("settings.gameData");

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("title")}</h2>
      {status.linked ? (
        <>
          <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <span className="text-sm">{t("autoSync.label")}</span>
              <InfoTooltip label={t("autoSync.label")}>{t("autoSync.tooltip")}</InfoTooltip>
            </div>
            <span
              data-testid="game-data-auto-sync-state"
              className={
                status.autoSync
                  ? "shrink-0 rounded-full bg-hq-accent/15 px-2.5 py-0.5 text-xs font-medium text-hq-accent"
                  : "shrink-0 rounded-full border border-hq-border px-2.5 py-0.5 text-xs font-medium text-hq-fg-muted"
              }
            >
              {status.autoSync ? t("autoSync.on") : t("autoSync.off")}
            </span>
          </div>
          <p className="mt-3 text-xs text-hq-fg-muted">{t("readOnlyHint")}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-hq-fg-muted">{t("notLinked")}</p>
      )}
    </section>
  );
}
