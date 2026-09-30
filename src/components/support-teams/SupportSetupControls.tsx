"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { locationOf } from "@/lib/support-teams/board-client.shared";
import { SupportDialog, SupportErrorMessage, supportButton, supportInput } from "./SupportTeamControls";
import type { BoardInteractions } from "./SupportTeamSlot";

export function SupportSetupControls({ snapshot, interactions, pending, error }: {
  snapshot: SupportSnapshot; interactions: BoardInteractions; pending: boolean; error?: string;
}) {
  const t = useTranslations("supportTeams");
  const locale = useLocale();
  const [create, setCreate] = useState<{ teamId: string } | null>(null);
  const [name, setName] = useState("");
  const [leadId, setLeadId] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const assigned = snapshot.roster.filter((member) => locationOf(snapshot, member.id) !== null).length;
  const createCommand = (lead: string): SupportCommand => ({ kind: "createTeam", teamId: create?.teamId ?? "", name: name.trim() || "x", leadId: lead, expectedVersion: snapshot.version });
  const publishCommand: SupportCommand = { kind: "publishSetup", expectedVersion: snapshot.version };
  const canPublish = interactions.canCommand(publishCommand);
  return <div className="space-y-2">
    <p className="text-sm text-hq-fg-muted">{t("assignmentProgress", { assigned: assigned.toLocaleString(locale), total: snapshot.roster.length.toLocaleString(locale) })}</p>
    {!canPublish && <p className="text-sm text-hq-fg-muted">{t("publishIncomplete")}</p>}
    <div className="flex flex-wrap gap-2">
      <button className={supportButton} disabled={pending} onClick={() => { setCreate({ teamId: crypto.randomUUID() }); setName(""); setLeadId(""); }}>{t("createTeam")}</button>
      <button className={supportButton} disabled={pending || !canPublish} onClick={() => setConfirmPublish(true)}>{t("publishTeams")}</button>
    </div>
    <SupportErrorMessage code={error} />
    {create && <SupportDialog title={t("createTeamTitle")} onClose={() => setCreate(null)}>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); interactions.onCommand(createCommand(leadId), "setup"); setCreate(null); }}>
        <label className="block text-sm">{t("teamName")}<input className={supportInput} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></label>
        <AppSelect value={leadId} onChange={setLeadId} aria-label={t("teamLead")} placeholder={t("chooseLead")} combobox searchable explicitSelection searchMode="fuzzy" searchPlaceholder={t("findMember")} noSearchResultsLabel={t("noMatches")} options={snapshot.roster.filter((member) => member.rank === 4 || member.rank === 5).map((member) => ({ value: member.id, label: member.name, disabled: pending || !interactions.canCommand(createCommand(member.id)) }))} />
        <button className={supportButton} disabled={pending || !name.trim() || !leadId || !interactions.canCommand(createCommand(leadId))}>{t("createTeam")}</button>
      </form>
    </SupportDialog>}
    {confirmPublish && <SupportDialog title={t("publishTitle")} onClose={() => setConfirmPublish(false)}>
      <p className="text-sm text-hq-fg-muted">{t("publishHint")}</p>
      <button className={`${supportButton} mt-4`} disabled={pending} onClick={() => { interactions.onCommand(publishCommand, "setup"); setConfirmPublish(false); }}>{t("publishTeams")}</button>
    </SupportDialog>}
  </div>;
}
