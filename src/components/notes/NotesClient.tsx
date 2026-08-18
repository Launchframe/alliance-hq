"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { NoteMemberMultiSelect } from "@/components/notes/NoteMemberMultiSelect";
import type {
  PerformanceNoteDto,
  PerformanceNoteKind,
  PerformanceNotesPagePayload,
} from "@/lib/performance-notes/types.shared";

type Props = {
  initial: PerformanceNotesPagePayload;
  focusNoteId?: string;
};

function kindLabel(
  t: (key: "kindCommendation" | "kindViolation" | "kindNote") => string,
  kind: PerformanceNoteKind,
) {
  if (kind === "commendation") return t("kindCommendation");
  if (kind === "violation") return t("kindViolation");
  return t("kindNote");
}

export function NotesClient({ initial, focusNoteId }: Props) {
  const t = useTranslations("notes");
  const [notes, setNotes] = useState(initial.notes);
  const [roster, setRoster] = useState(initial.roster);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PerformanceNoteKind>("note");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyPayload = useCallback((payload: PerformanceNotesPagePayload) => {
    setNotes(payload.notes);
    setRoster(payload.roster);
  }, []);

  async function createNote() {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, kind }),
      });
      const payload = (await res.json().catch(() => null)) as
        | PerformanceNotesPagePayload
        | { error?: string }
        | null;
      if (!res.ok || !payload || !("notes" in payload)) {
        setError(
          payload && "error" in payload && payload.error
            ? payload.error
            : t("saveFailed"),
        );
        return;
      }
      applyPayload(payload);
      setBody("");
    } finally {
      setSaving(false);
    }
  }

  async function saveMembers(noteId: string, memberIds: string[]) {
    setError(null);
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds }),
    });
    const payload = (await res.json().catch(() => null)) as
      | { note?: PerformanceNoteDto; roster?: PerformanceNotesPagePayload["roster"] }
      | { error?: string }
      | null;
    if (!res.ok || !payload || !("note" in payload) || !payload.note) {
      setError(
        payload && "error" in payload && payload.error
          ? payload.error
          : t("membersSaveFailed"),
      );
      return;
    }
    setNotes((prev) =>
      prev.map((note) => (note.id === noteId ? payload.note! : note)),
    );
    if (payload.roster) setRoster(payload.roster);
  }

  const visible = focusNoteId
    ? notes.filter((note) => note.id === focusNoteId)
    : notes;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-muted">{t("subtitle")}</p>
      </div>

      {focusNoteId ? (
        <Link href="/notes" className="text-sm text-hq-accent hover:underline">
          {t("backToNotes")}
        </Link>
      ) : (
        <form
          className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createNote();
          }}
        >
          <label className="block text-sm font-medium text-hq-fg">
            {t("kindLabel")}
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as PerformanceNoteKind)
              }
              className="mt-1 block w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm"
            >
              <option value="note">{t("kindNote")}</option>
              <option value="commendation">{t("kindCommendation")}</option>
              <option value="violation">{t("kindViolation")}</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-hq-fg">
            {t("bodyLabel")}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            />
          </label>
          <button
            type="submit"
            disabled={saving || body.trim().length === 0}
            className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t("saving") : t("saveNote")}
          </button>
        </form>
      )}

      {error ? (
        <p className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-4 py-2 text-sm text-hq-danger">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">
          {focusNoteId ? t("notFound") : t("empty")}
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((note) => (
            <li
              key={note.id}
              className="rounded-xl border border-hq-border bg-hq-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-hq-border bg-hq-canvas px-2.5 py-0.5 text-xs font-medium text-hq-fg">
                  {kindLabel(t, note.kind)}
                </span>
                <Link
                  href={`/notes/${note.id}`}
                  className="text-xs text-hq-accent hover:underline"
                >
                  {new Date(note.createdAt).toLocaleString()}
                </Link>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-hq-fg">
                {note.body}
              </p>
              {note.members.length > 0 ? (
                <p className="mt-2 text-xs text-hq-fg-muted">
                  {t("attached")}:{" "}
                  {note.members.map((member) => member.name).join(", ")}
                </p>
              ) : null}
              <NoteMemberMultiSelect
                roster={roster}
                attachedIds={note.members.map((member) => member.ashedMemberId)}
                onSave={(memberIds) => saveMembers(note.id, memberIds)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
