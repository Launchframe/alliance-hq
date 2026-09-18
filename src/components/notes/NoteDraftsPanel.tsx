"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatAccountDate } from "@/lib/timezone/format";
import { useNotesFetch } from "./NotesNavigation";

export function NoteDraftsPanel({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: boolean }) {
  const t = useTranslations("notes");
  const fetchNotes = useNotesFetch();
  const locale = useLocale();
  const [rows, setRows] = useState<Array<{ id: string; title: string; source: "web" | "discord"; updatedAt: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchNotes("/api/notes/drafts", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("loadFailed"));
      if (!controller.signal.aborted) { setRows(payload.drafts); setError(null); }
    }).catch((failure) => { if (!controller.signal.aborted) { setRows([]); setError(failure instanceof Error ? failure.message : t("loadFailed")); } });
    return () => controller.abort();
  }, [refreshKey, t, fetchNotes]);
  return <section className="min-w-0 flex-1 space-y-4 p-6"><h2 className="font-semibold">{t("views.drafts")}</h2><p className="text-sm text-hq-fg-muted">{t("drafts.private")}</p>{error ? <p role="alert" className="text-hq-danger">{error}</p> : null}{!rows.length ? <p className="text-sm text-hq-fg-muted">{t("drafts.empty")}</p> : rows.map((draft) => <button key={draft.id} onClick={() => onOpen(draft.id)} className="block w-full space-y-1 rounded-xl border border-hq-border bg-hq-canvas p-4 text-left"><span className="block font-medium">{draft.title || t("drafts.untitled")}</span><span className="text-xs text-hq-fg-muted">{t(`source.${draft.source}`)} · {formatAccountDate(draft.updatedAt, { locale, timezoneId: "server", dateStyle: "medium" })}</span></button>)}</section>;
}
