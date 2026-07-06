"use client";

import { Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Summary = {
  total: number;
  videoJobsFailed: number;
  videoJobsStuckQueued: number;
  bugReportsOpen: number;
};

const POLL_MS = 60_000;

export function OpsInboxBell() {
  const t = useTranslations("admin.opsInbox");
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/admin/inbox/summary");
        if (!res.ok) return;
        const data = (await res.json()) as Summary;
        if (!cancelled) setSummary(data);
      } catch {
        /* ignore poll errors */
      }
    }

    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const count = summary?.total ?? 0;
  const badgeLabel =
    count > 99 ? "99+" : count > 0 ? String(count) : undefined;

  return (
    <Link
      href="/admin/inbox"
      className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hq-border text-hq-fg transition-colors hover:bg-hq-surface-muted"
      aria-label={
        count > 0
          ? t("bellLabelWithCount", { count })
          : t("bellLabel")
      }
    >
      <Wrench className="h-5 w-5" aria-hidden />
      {badgeLabel ? (
        <span
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-hq-danger px-1 text-[10px] font-semibold text-white"
          aria-hidden
        >
          {badgeLabel}
        </span>
      ) : null}
    </Link>
  );
}
