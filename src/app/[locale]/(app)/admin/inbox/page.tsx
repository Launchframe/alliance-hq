"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import type { OpsInboxItemKind } from "@/lib/admin/ops-inbox";

type InboxItem = {
  id: string;
  kind: OpsInboxItemKind;
  title: string;
  subtitle: string | null;
  href: string;
  createdAt: string;
};

type Summary = {
  total: number;
  videoJobsFailed: number;
  videoJobsStuckQueued: number;
  bugReportsOpen: number;
  memberLinkHelpOpen: number;
};

export default function AdminOpsInboxPage() {
  const t = useTranslations("admin.opsInbox");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [itemsRes, summaryRes] = await Promise.all([
        fetch("/api/admin/inbox"),
        fetch("/api/admin/inbox/summary"),
      ]);
      if (!itemsRes.ok || !summaryRes.ok) {
        throw new Error(t("loadFailed"));
      }
      const itemsData = (await itemsRes.json()) as { items: InboxItem[] };
      const summaryData = (await summaryRes.json()) as Summary;
      setItems(itemsData.items);
      setSummary(summaryData);
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

  function kindLabel(kind: OpsInboxItemKind): string {
    return t(`kind.${kind}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      {summary ? (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3">
            <dt className="text-xs text-hq-fg-muted">{t("counts.failed")}</dt>
            <dd className="text-xl font-semibold">{summary.videoJobsFailed}</dd>
          </div>
          <div className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3">
            <dt className="text-xs text-hq-fg-muted">{t("counts.stuck")}</dt>
            <dd className="text-xl font-semibold">
              {summary.videoJobsStuckQueued}
            </dd>
          </div>
          <div className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3">
            <dt className="text-xs text-hq-fg-muted">{t("counts.bugs")}</dt>
            <dd className="text-xl font-semibold">{summary.bugReportsOpen}</dd>
          </div>
          <div className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3">
            <dt className="text-xs text-hq-fg-muted">{t("counts.memberLinkHelp")}</dt>
            <dd className="text-xl font-semibold">{summary.memberLinkHelpOpen}</dd>
          </div>
        </dl>
      ) : null}

      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

      {items.length === 0 && !error ? (
        <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hq-border rounded-xl border border-hq-border bg-hq-surface">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-hq-surface-muted sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-hq-accent">
                    {kindLabel(item.kind)}
                  </p>
                  <p className="truncate font-medium group-hover:text-hq-accent group-hover:underline">
                    {item.title}
                  </p>
                  {item.subtitle ? (
                    <p className="truncate text-sm text-hq-fg-muted">
                      {item.subtitle}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-xs text-hq-fg-muted">
                  <FormattedDateTime value={item.createdAt} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
