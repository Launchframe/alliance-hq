"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { MEMBER_LINK_HELP_INBOX_KIND } from "@/lib/member-link/member-link-help-inbox.shared";
import { ONBOARDING_REVIEW_INBOX_KIND } from "@/lib/member-link/onboarding-review-inbox.shared";
import { ROSTER_LINK_INBOX_KIND } from "@/lib/member-link/roster-link-inbox.shared";
import { Link } from "@/i18n/navigation";
import { dispatchInboxRemindersRefresh } from "@/lib/inbox-reminders-refresh.shared";

type ReminderItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  scoreTarget: string | null;
  createdAt: string;
};

export default function InboxPageClient({
  showRosterLinkRequestsLink = false,
}: {
  showRosterLinkRequestsLink?: boolean;
}) {
  const t = useTranslations("inbox");
  const tRoster = useTranslations("rosterLinkRequests");
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
      dispatchInboxRemindersRefresh();
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
      dispatchInboxRemindersRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dismissFailed"));
    } finally {
      setDismissingId(null);
    }
  }

  function kindLabel(kind: string): string {
    if (kind === "eur_occurrence") return t("kind.eurOccurrence");
    if (kind === "video_jobs_pending") return t("kind.videoJobsPending");
    if (kind === ROSTER_LINK_INBOX_KIND) return t("kind.memberLinkRequest");
    if (kind === ONBOARDING_REVIEW_INBOX_KIND) return t("kind.memberOnboardingReview");
    if (kind === MEMBER_LINK_HELP_INBOX_KIND) return t("kind.memberLinkHelp");
    return kind;
  }

  function displayTitle(item: ReminderItem): string {
    if (item.kind === ROSTER_LINK_INBOX_KIND) {
      const name = item.scoreTarget?.trim() || item.title;
      return t("kind.memberLinkRequestTitle", { name });
    }
    if (item.kind === ONBOARDING_REVIEW_INBOX_KIND) {
      const name = item.scoreTarget?.trim() || item.title;
      return t("kind.memberOnboardingReviewTitle", { name });
    }
    if (item.kind === MEMBER_LINK_HELP_INBOX_KIND) {
      const name = item.scoreTarget?.trim() || item.title;
      return t("kind.memberLinkHelpTitle", { name });
    }
    return item.title;
  }

  function displayBody(item: ReminderItem): string | null {
    if (item.kind === ROSTER_LINK_INBOX_KIND) {
      return t("kind.memberLinkRequestBody");
    }
    if (item.kind === ONBOARDING_REVIEW_INBOX_KIND) {
      return t("kind.memberOnboardingReviewBody");
    }
    if (item.kind === MEMBER_LINK_HELP_INBOX_KIND) {
      return t("kind.memberLinkHelpBody");
    }
    return item.body;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        </div>
        {items.length > 0 ? (
          <button
            type="button"
            disabled={dismissingId === "all"}
            onClick={() => void dismissAll()}
            className="shrink-0 rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
          >
            {t("dismissAll")}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

      {items.length === 0 && !error ? (
        <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hq-border rounded-xl border border-hq-border bg-hq-surface">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                item.href ? "transition-colors hover:bg-hq-surface-muted" : ""
              }`}
            >
              {item.href ? (
                <Link
                  href={item.href}
                  className="group min-w-0 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#388bfd]"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-hq-accent">
                    {kindLabel(item.kind)}
                  </p>
                  <p className="truncate font-medium text-hq-fg group-hover:text-hq-accent group-hover:underline">
                    {displayTitle(item)}
                  </p>
                  {displayBody(item) ? (
                    <p className="truncate text-sm text-hq-fg-muted">
                      {displayBody(item)}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-hq-fg-muted">
                    <FormattedDateTime value={item.createdAt} />
                  </p>
                </Link>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-hq-accent">
                    {kindLabel(item.kind)}
                  </p>
                  <p className="truncate font-medium">{displayTitle(item)}</p>
                  {displayBody(item) ? (
                    <p className="truncate text-sm text-hq-fg-muted">
                      {displayBody(item)}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-hq-fg-muted">
                    <FormattedDateTime value={item.createdAt} />
                  </p>
                </div>
              )}
              <button
                type="button"
                disabled={dismissingId === item.id}
                onClick={() => void dismissOne(item.id)}
                className="shrink-0 self-start rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg disabled:opacity-50 sm:self-center"
              >
                {t("dismiss")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 text-sm text-hq-fg-muted">
        {showRosterLinkRequestsLink ? (
          <p>
            <Link
              href="/members/roster-link-requests"
              className="text-hq-accent hover:underline"
            >
              {tRoster("title")}
            </Link>
          </p>
        ) : null}
        <p>
          <Link
            href="/settings/upload-reminders"
            className="text-hq-accent hover:underline"
          >
            {t("manageSchedules")}
          </Link>
        </p>
      </div>
    </div>
  );
}
