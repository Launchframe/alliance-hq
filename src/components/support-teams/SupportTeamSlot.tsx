"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import { MemberBoardSearch } from "@/components/member-board/MemberBoard";
import { SupportMemberIdentity } from "./SupportMemberChip";
import { supportButton, supportInput } from "./SupportTeamControls";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { locationOf, supportBoardData } from "@/lib/support-teams/board-client.shared";

export type BoardInteractions = {
  eligibility: (memberId: string, to: string | null, otherMemberId?: string) => string | null;
  onMove: (memberId: string, to: string | null, otherMemberId?: string) => void;
  canCommand: (command: SupportCommand) => boolean;
  onCommand: (command: SupportCommand, slot: string) => void;
};
export type TeamNames = (id: string | null) => string;
export function SupportTeamMemberSearch({ snapshot, teamName, label, value, onSelect, eligible }: {
  snapshot: SupportSnapshot; teamName: TeamNames; label: string; value: string; onSelect: (id: string) => void; eligible?: (id: string) => boolean;
}) {
  const t = useTranslations("supportTeams");
  return <MemberBoardSearch data={supportBoardData(snapshot, teamName, t("unknown"))} labels={{ pool: t("unsorted"), findMember: t("findMember"), noMatches: t("noMatches") }} label={label} value={value} onSelect={onSelect} eligible={eligible} renderIdentity={(member) => <SupportMemberIdentity member={member} />} />;
}

type SlotProps = { snapshot: SupportSnapshot; team: SupportSnapshot["teams"][number]; teamName: TeamNames; interactions: BoardInteractions; pending: boolean };
export function SupportTeamHeader({ snapshot, team, teamName, own }: Pick<SlotProps, "snapshot" | "team" | "teamName"> & { own: boolean }) {
  const t = useTranslations("supportTeams");
  const locale = useLocale();
  const lead = snapshot.roster.find((member) => member.id === team.leadId);
  return <header><h2 className="font-semibold">{teamName(team.id)} {own && <span className="text-xs text-hq-accent">{t("myTeam")}</span>}</h2><p className="text-sm text-hq-fg-muted">{t("size", { count: team.memberIds.length.toLocaleString(locale), target: team.target.toLocaleString(locale) })}</p>{lead && <SupportMemberIdentity member={lead} />}{team.needsReplacement && <p className="text-sm text-hq-warning">{t("leadNeedsReplacement")}</p>}</header>;
}

export function SupportTeamSlotActions({ snapshot, team, teamName, interactions, pending }: SlotProps) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [replace, setReplace] = useState(false);
  const renameCommand: SupportCommand = { kind: "rename", teamId: team.id, name: name || teamName(team.id), expectedVersion: snapshot.version };
  const canRename = interactions.canCommand({ ...renameCommand, name: teamName(team.id) });
  return <>
    {canRename && <div className="flex flex-wrap gap-2"><button className={supportButton} onClick={() => { setName(team.name ?? ""); setRenaming(!renaming); }}>{t("rename")}</button>{snapshot.roster.some((member) => interactions.canCommand({ kind: "replaceLead", teamId: team.id, leadId: member.id, expectedVersion: snapshot.version })) && <button className={supportButton} onClick={() => setReplace(!replace)}>{t("replaceLead")}</button>}</div>}
    {renaming && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); interactions.onCommand({ ...renameCommand, name }, team.id); }}><label className="text-sm">{t("teamName")}<input className={supportInput} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></label><button className={supportButton} disabled={pending || !name.trim()}>{tr("battlePlan.actions.save")}</button></form>}
    {replace && <AppSelect value="" onChange={(leadId) => interactions.onCommand({ kind: "replaceLead", leadId, teamId: team.id, expectedVersion: snapshot.version }, team.id)} aria-label={t("replaceLead")} placeholder={t("leadRequired")} searchable combobox explicitSelection searchMode="fuzzy" searchPlaceholder={t("findMember")} noSearchResultsLabel={t("noMatches")} options={snapshot.roster.filter((member) => member.rank === 4 || member.rank === 5).map((member) => ({ value: member.id, label: member.name, disabled: pending || !interactions.canCommand({ kind: "replaceLead", leadId: member.id, teamId: team.id, expectedVersion: snapshot.version }) }))} />}
  </>;
}

export function SupportTeamMemberActions({ snapshot, memberId, teamName, interactions, pending, swap, onToggleSwap }: Omit<SlotProps, "team"> & { memberId: string; swap: boolean; onToggleSwap: () => void }) {
  const t = useTranslations("supportTeams");
  return <>
    {snapshot.roster.some((other) => { const to = locationOf(snapshot, other.id); return to && !interactions.eligibility(memberId, to, other.id); }) && <button className={`${supportButton} mt-2`} onClick={onToggleSwap}>{t("swapMembers")}</button>}
    {swap && <SupportTeamMemberSearch snapshot={snapshot} teamName={teamName} label={t("swapMembers")} value="" eligible={(other) => { const to = locationOf(snapshot, other); return !!to && !pending && !interactions.eligibility(memberId, to, other); }} onSelect={(other) => interactions.onMove(memberId, locationOf(snapshot, other), other)} />}
  </>;
}
