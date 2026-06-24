"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Link } from "@/i18n/navigation";

type ReminderItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  scoreTarget: string | null;
  createdAt: string;
};

export default function InboxPageClient() {
  const t = useTranslations("inbox");
  const [items, setItems] = useState<ReminderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/reminders");
      if (!res.ok) throw new Error(t("loadFailed"));
      const data = (await res.json()) as { items: ReminderItem[] };
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function dismissOne(id: string) {
    setDismissingId(id);
    try {
      const res = await fetch(`/api/inbox/reminders/${id}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(t("dismissFailed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dismissFailed"));
    } finally {
      setDismissingId(null);
    }
  }

  async function dismissAll() {
    setDismissingId("all");
    try {
      const res = await fetch("/api/inbox/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_all" }),
      });
      if (!res.ok) throw new Error(t("dismissFailed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dismissFailed"));
    } finally {
      setDismissingId(null);
    }
  }

  function kindLabel(kind: string): string {
    if (kind === "eur_occurrence") return t("kind.eurOccurrence");
    if (kind === "video_jobs_pending") return t("kind.videoJobsPending");
    return kind;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </div>
        {items.length > 0 ? (
          <button
            type="button"
            disabled={dismissingId === "all"}
            onClick={() => void dismissAll()}
            className="shrink-0 rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#e6edf3] hover:bg-[#21262d] disabled:opacity-50"
          >
            {t("dismissAll")}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

      {items.length === 0 && !error ? (
        <p className="text-sm text-[#8b949e]">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-[#30363d] rounded-xl border border-[#30363d] bg-[#161b22]">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-[#58a6ff]">
                  {kindLabel(item.kind)}
                </p>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="block truncate font-medium hover:text-[#58a6ff]"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <p className="truncate font-medium">{item.title}</p>
                )}
                {item.body ? (
                  <p className="truncate text-sm text-[#8b949e]">{item.body}</p>
                ) : null}
                <p className="mt-1 text-xs text-[#8b949e]">
                  <FormattedDateTime value={item.createdAt} />
                </p>
              </div>
              <button
                type="button"
                disabled={dismissingId === item.id}
                onClick={() => void dismissOne(item.id)}
                className="shrink-0 self-start rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] disabled:opacity-50 sm:self-center"
              >
                {t("dismiss")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-[#8b949e]">
        <Link
          href="/settings/upload-reminders"
          className="text-[#58a6ff] hover:underline"
        >
          {t("manageSchedules")}
        </Link>
      </p>
    </div>
  );
}
