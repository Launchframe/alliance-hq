"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { OfficerActionItemRecord } from "@/lib/officer-intel/synthesis-types.shared";

type Props = {
  initialItems: OfficerActionItemRecord[];
  canWrite: boolean;
  focusItemId?: string | null;
};

export function OfficerActionItemsClient({
  initialItems,
  canWrite,
  focusItemId,
}: Props) {
  const t = useTranslations("officerIntel");
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/officer-intel/action-items");
    const body = (await res.json().catch(() => null)) as
      | { items?: OfficerActionItemRecord[]; error?: string }
      | null;
    if (!res.ok || !body?.items) {
      setError(body?.error ?? t("loadFailed"));
      return;
    }
    setItems(body.items);
  }, [t]);

  useEffect(() => {
    if (!focusItemId) return;
    const element = document.getElementById(`action-item-${focusItemId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusItemId, items]);

  async function updateStatus(
    itemId: string,
    status: OfficerActionItemRecord["status"],
  ) {
    const res = await fetch(`/api/officer-intel/action-items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError(t("updateActionItemFailed"));
      return;
    }
    await refresh();
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href="/officer-intel"
          className="text-sm text-hq-accent hover:underline"
        >
          {t("backToHub")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-hq-fg">
          {t("actionItemsPageTitle")}
        </h1>
        <p className="text-sm text-hq-muted">{t("actionItemsPageSubtitle")}</p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-hq-muted">{t("noOpenActionItems")}</p>
      ) : (
        <ul className="divide-y divide-hq-border rounded-xl border border-hq-border bg-hq-surface">
          {items.map((item) => (
            <li
              key={item.id}
              id={`action-item-${item.id}`}
              className={`px-4 py-4 ${
                focusItemId === item.id ? "bg-hq-muted/10" : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-hq-fg">{item.title}</p>
                  {item.description ? (
                    <p className="mt-1 text-sm text-hq-muted">
                      {item.description}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-hq-muted">
                    {item.assigneeMemberName ??
                      item.assigneeNameRaw ??
                      t("unassigned")}
                    {item.dueAt
                      ? ` · ${new Date(item.dueAt).toLocaleString()}`
                      : item.dueHint
                        ? ` · ${item.dueHint}`
                        : ""}
                  </p>
                  <Link
                    href={`/officer-intel/notes/${item.noteId}`}
                    className="mt-2 inline-block text-xs text-hq-accent hover:underline"
                  >
                    {t("viewMeetingNotes")}
                  </Link>
                </div>
                <span className="text-xs uppercase text-hq-muted">
                  {t(`priority.${item.priority}`)} · {t(`status.${item.status}`)}
                </span>
              </div>
              {canWrite ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status === "open" ? (
                    <button
                      type="button"
                      className="rounded border border-hq-border px-2 py-1 text-xs"
                      onClick={() => void updateStatus(item.id, "in_progress")}
                    >
                      {t("markInProgress")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded border border-hq-border px-2 py-1 text-xs"
                    onClick={() => void updateStatus(item.id, "done")}
                  >
                    {t("markDone")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
