"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { INBOX_REMINDERS_REFRESH_EVENT } from "@/lib/inbox-reminders-refresh.shared";

const POLL_MS = 60_000;

export function ReminderInboxBell() {
  const t = useTranslations("inbox");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/inbox/reminders/summary");
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) setCount(data.count ?? 0);
      } catch {
        /* ignore poll errors */
      }
    }

    void load();
    const id = window.setInterval(() => void load(), POLL_MS);

    function handleRefresh() {
      void load();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void load();
      }
    }

    window.addEventListener(INBOX_REMINDERS_REFRESH_EVENT, handleRefresh);
    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener(INBOX_REMINDERS_REFRESH_EVENT, handleRefresh);
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const badgeLabel =
    count > 99 ? "99+" : count > 0 ? String(count) : undefined;

  return (
    <Link
      href="/inbox"
      className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hq-border text-hq-fg transition-colors hover:bg-hq-surface-muted"
      aria-label={
        count > 0 ? t("bellLabelWithCount", { count }) : t("bellLabel")
      }
    >
      <Bell className="h-5 w-5" aria-hidden />
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
