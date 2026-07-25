"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import type {
  OfficerActionItemRecord,
  OfficerMeetingNoteSummary,
} from "@/lib/officer-intel/synthesis-types.shared";

type Props = {
  note: OfficerMeetingNoteSummary;
  actionItems: OfficerActionItemRecord[];
  canWrite: boolean;
  sessionTitle: string;
};

export function OfficerMeetingNoteClient({
  note: initialNote,
  actionItems: initialActionItems,
  canWrite,
  sessionTitle,
}: Props) {
  const t = useTranslations("officerIntel");
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [actionItems, setActionItems] = useState(initialActionItems);
  const [summary, setSummary] = useState(note.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveNote(approve: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/officer-intel/notes/${note.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, approve }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            note?: OfficerMeetingNoteSummary;
            actionItems?: OfficerActionItemRecord[];
            error?: string;
          }
        | null;
      if (!res.ok || !body?.note) {
        setError(body?.error ?? t("saveNoteFailed"));
        return;
      }
      setNote(body.note);
      setSummary(body.note.summary);
      if (body.actionItems) setActionItems(body.actionItems);
      router.refresh();
    } catch {
      setError(t("saveNoteFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function updateItemStatus(
    itemId: string,
    status: OfficerActionItemRecord["status"],
  ) {
    const res = await fetch(`/api/officer-intel/action-items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json().catch(() => null)) as
      | { item?: OfficerActionItemRecord }
      | null;
    if (!res.ok || !body?.item) return;
    setActionItems((items) =>
      items.map((item) => (item.id === itemId ? body.item! : item)),
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6 px-4 py-6">
      <div>
        <Link
          href={`/officer-intel/sessions/${note.sessionId}`}
          className="text-sm text-hq-accent hover:underline"
        >
          {t("backToSession")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-hq-fg">
          {t("meetingNotesTitle")}
        </h1>
        <p className="text-sm text-hq-muted">{sessionTitle}</p>
        <p className="mt-1 text-xs text-hq-muted">
          {note.status === "approved"
            ? t("noteStatusApproved")
            : t("noteStatusDraft")}
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("summary")}</h2>
        {canWrite && note.status === "draft" ? (
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={8}
            className="w-full rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-sm"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{note.summary}</p>
        )}
      </section>

      {note.keyDecisions.length > 0 ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("keyDecisions")}</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {note.keyDecisions.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {note.openQuestions.length > 0 ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("openQuestions")}</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {note.openQuestions.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("actionItemsTitle")}</h2>
          <Link
            href="/officer-intel/action-items"
            className="text-sm text-hq-accent hover:underline"
          >
            {t("viewAllActionItems")}
          </Link>
        </div>
        {actionItems.length === 0 ? (
          <p className="text-sm text-hq-muted">{t("noActionItems")}</p>
        ) : (
          <ul className="divide-y divide-hq-border">
            {actionItems.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
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
                  </div>
                  <span className="text-xs uppercase text-hq-muted">
                    {t(`priority.${item.priority}`)} ·{" "}
                    {t(`status.${item.status}`)}
                  </span>
                </div>
                {canWrite && item.status !== "done" && item.status !== "cancelled" ? (
                  <div className="flex flex-wrap gap-2">
                    {item.status === "open" ? (
                      <button
                        type="button"
                        className="rounded border border-hq-border px-2 py-1 text-xs"
                        onClick={() => void updateItemStatus(item.id, "in_progress")}
                      >
                        {t("markInProgress")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded border border-hq-border px-2 py-1 text-xs"
                      onClick={() => void updateItemStatus(item.id, "done")}
                    >
                      {t("markDone")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite && note.status === "draft" ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveNote(false)}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? t("saving") : t("saveDraft")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveNote(true)}
            className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t("saving") : t("approveNotes")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
