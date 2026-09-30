"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SupportTeamClient } from "@/components/support-teams/SupportTeamClient";
import { SupportDialog, SupportErrorMessage, supportButton } from "@/components/support-teams/SupportTeamControls";
import type { DisplayState } from "@/components/support-teams/useSupportTeamLive";
import { defaultDisplayPreferences } from "@/lib/support-teams/display-preferences.shared";
import type { SupportSnapshot } from "@/lib/support-teams/types.shared";

export type SupportNoteMember = { id: string; name: string };
export type NoteAudience = "private" | "officers_read";
type Bootstrap = SupportSnapshot & { preferences?: DisplayState; canInvite?: boolean };

export function NotesTeamsPanel({ canCreate, onAddNote, onViewNotes }: {
  canCreate: boolean;
  onAddNote: (member: SupportNoteMember, audience: NoteAudience) => void;
  onViewNotes: (memberId: string) => void;
}) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [noteTarget, setNoteTarget] = useState<SupportNoteMember | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/support-teams?bootstrap=1", { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !body) setError(body?.code ?? "changed");
        else setBootstrap(body);
      } catch {
        if (!controller.signal.aborted) setError("changed");
      }
    })();
    return () => controller.abort();
  }, []);
  if (error) return <section className="min-w-0 flex-1 p-4 sm:p-6">{error === "forbidden" ? <p role="alert" className="text-sm text-hq-danger">{tr("notes.errors.forbidden")}</p> : <SupportErrorMessage code={error} />}</section>;
  if (!bootstrap) return <p role="status" className="p-6 text-sm">{tr("common.loading")}</p>;
  const nameOf = (id: string) => bootstrap.roster.find((member) => member.id === id)?.name ?? id;
  return <>
    <SupportTeamClient embedded initial={bootstrap} initialPreferences={bootstrap.preferences ?? { version: 0, display: { ...defaultDisplayPreferences } }} canInvite={bootstrap.canInvite ?? false} memberActions={(id) => <>
      {canCreate && <button type="button" className={`${supportButton} mt-2`} onClick={() => setNoteTarget({ id, name: nameOf(id) })}>{t("addNote")}</button>}
      <button type="button" className={`${supportButton} mt-2`} onClick={() => onViewNotes(id)}>{t("viewNotes")}</button>
    </>} />
    {noteTarget && <SupportDialog title={t("noteAudienceTitle", { member: noteTarget.name })} onClose={() => setNoteTarget(null)}>
      <div className="flex flex-col gap-2">
        <button type="button" className={supportButton} onClick={() => { onAddNote(noteTarget, "private"); setNoteTarget(null); }}>{t("noteAudiencePrivate")}</button>
        <button type="button" className={supportButton} onClick={() => { onAddNote(noteTarget, "officers_read"); setNoteTarget(null); }}>{t("noteAudienceOfficers")}</button>
      </div>
    </SupportDialog>}
  </>;
}
