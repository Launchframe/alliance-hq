"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import type { OfficerIntelDashboardPayload } from "@/lib/officer-intel/types.shared";

type Props = {
  initial: OfficerIntelDashboardPayload;
};

export function OfficerIntelClient({ initial }: Props) {
  const t = useTranslations("officerIntel");
  const tNotes = useTranslations("notes");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-muted">{t("subtitle")}</p>
        </div>
      </div>

      {!initial.translationConfigured ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-hq-fg">
          {t("translationUnavailable")}
        </p>
      ) : null}

      {initial.openActionItemCount > 0 ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface px-4 py-3">
          <Link
            href="/officer-intel/action-items"
            className="text-sm font-medium text-hq-accent hover:underline"
          >
            {t("openActionItemsLink", {
              count: initial.openActionItemCount,
            })}
          </Link>
        </section>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface px-4 py-3">
        <Link
          href="/notes?view=chatLogs"
          className="text-sm font-medium text-hq-accent hover:underline"
        >
          {tNotes("views.chatLogs")}
        </Link>
      </section>
    </div>
  );
}
