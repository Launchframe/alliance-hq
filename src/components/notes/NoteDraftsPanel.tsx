"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatAccountDate } from "@/lib/timezone/format";
import { useNotesFetch, useNotesNavigation } from "./NotesNavigation";

type Draft = { id: string; title: string; source: "web" | "discord"; updatedAt: string };
export function NoteDraftsPanel({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: boolean }) {
  const t = useTranslations("notes"), locale = useLocale();
  const fetchNotes = useNotesFetch(), navigation = useNotesNavigation(), cursor = navigation.params.get("draftCursor");
  const [page, setPage] = useState<{ cursor: string | null; drafts: Draft[]; nextCursor: string | null; previousCursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const errorAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
    void fetchNotes(`/api/notes/drafts${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || payload.scope !== navigation.scope) throw new Error(payload.error ?? t("loadFailed"));
      if (!controller.signal.aborted) { setPage({ ...payload, cursor }); setError(null); }
    }).catch((failure) => { if (!controller.signal.aborted) { setPage(null); setError(failure instanceof Error ? failure.message : t("loadFailed")); } });
    return () => controller.abort();
  }, [cursor, refreshKey, retry, t, fetchNotes, navigation.scope]);
  useEffect(() => { if (error) errorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const current = page?.cursor === cursor ? page : null;
  const button = "rounded-lg border border-hq-border px-3 py-2 text-sm disabled:opacity-40";
  return <section className="min-w-0 flex-1 space-y-4 p-6" data-testid="notes-drafts"><h2 className="font-semibold">{t("views.drafts")}</h2><p className="text-sm text-hq-fg-muted">{t("drafts.private")}</p>
    <div ref={errorAnchor}>{error && <><p role="alert" className="text-hq-danger">{error}</p><button className={button} onClick={() => setRetry((value) => value + 1)}>{t("workspace.retryLoading")}</button></>}</div>
    {current && !current.drafts.length && <p className="text-sm text-hq-fg-muted">{t("drafts.empty")}</p>}
    {current?.drafts.map((draft) => <button key={draft.id} onClick={() => onOpen(draft.id)} className="block w-full space-y-1 rounded-xl border border-hq-border bg-hq-canvas p-4 text-left"><span className="block font-medium">{draft.title || t("drafts.untitled")}</span><span className="text-xs text-hq-fg-muted">{t(`source.${draft.source}`)} · {formatAccountDate(draft.updatedAt, { locale, timezoneId: "server", dateStyle: "medium" })}</span></button>)}
    <div className="flex gap-2"><button className={button} disabled={!current?.previousCursor && !(cursor && current && !current.drafts.length)} onClick={() => navigation.change({ draftCursor: current?.previousCursor ?? null })}>{t("imports.previous")}</button><button className={button} disabled={!current?.nextCursor} onClick={() => navigation.change({ draftCursor: current?.nextCursor ?? null })}>{t("imports.next")}</button></div>
  </section>;
}
