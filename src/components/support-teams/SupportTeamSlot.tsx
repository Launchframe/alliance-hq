"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import { SupportMemberChip, SupportMemberIdentity } from "./SupportMemberChip";
import { SupportErrorMessage, supportButton, supportInput } from "./SupportTeamControls";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import type { SupportDisplayPreferences } from "@/lib/support-teams/display-preferences.shared";
import { locationOf } from "@/lib/support-teams/board-client.shared";

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
  return <AppSelect value={value} onChange={onSelect} combobox searchable explicitSelection retainFocusOnSelect searchMode="fuzzy" aria-label={label} placeholder={label} searchPlaceholder={t("findMember")} noSearchResultsLabel={t("noMatches")} options={snapshot.roster.map((member) => ({ value: member.id, selectedText: member.name, label: <span><SupportMemberIdentity member={member} /><span className="ml-2 text-xs text-hq-fg-muted">{teamName(locationOf(snapshot, member.id))}</span></span>, searchText: [member.name, ...member.previousNames].join(" "), disabled: eligible ? !eligible(member.id) : false }))} />;
}
export function SupportTeamSlot({ snapshot, team, teamName, own, display, highlighted, dragged, setDragged, interactions, pending, error, renderMemberActions }: {
  snapshot: SupportSnapshot; team: SupportSnapshot["teams"][number]; teamName: TeamNames; own: boolean; display: SupportDisplayPreferences;
  highlighted: string; dragged: string | null; setDragged: (id: string | null) => void; interactions: BoardInteractions; pending: boolean; error?: string;
  renderMemberActions?: (id: string) => ReactNode;
}) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const locale = useLocale();
  const [selected, setSelected] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [replace, setReplace] = useState(false);
  const [swap, setSwap] = useState<string | null>(null);
  const lead = snapshot.roster.find((member) => member.id === team.leadId);
  const renameCommand: SupportCommand = { kind: "rename", teamId: team.id, name: name || teamName(team.id), expectedVersion: snapshot.version };
  const canRename = interactions.canCommand({ ...renameCommand, name: teamName(team.id) });
  const canAdd = snapshot.roster.some((member) => !interactions.eligibility(member.id, team.id));
  const dropError = dragged ? interactions.eligibility(dragged, team.id) : null;
  return <section data-support-team={team.id} aria-label={teamName(team.id)} aria-busy={pending} className={`min-w-0 space-y-3 rounded-xl border bg-hq-surface p-4 ${own ? "border-hq-accent" : "border-hq-border"} ${dragged && dropError ? "opacity-70" : ""}`}
    onDragOver={(event) => { if (dragged && !dropError && !pending) event.preventDefault(); }}
    onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("application/x-support-member"); if (id && !interactions.eligibility(id, team.id) && !pending) interactions.onMove(id, team.id); setDragged(null); }}>
    <header><h2 className="font-semibold">{teamName(team.id)} {own && <span className="text-xs text-hq-accent">{t("myTeam")}</span>}</h2><p className="text-sm text-hq-fg-muted">{t("size", { count: team.memberIds.length.toLocaleString(locale), target: team.target.toLocaleString(locale) })}</p>{lead && <SupportMemberIdentity member={lead} />}{team.needsReplacement && <p className="text-sm text-hq-warning">{t("leadNeedsReplacement")}</p>}</header>
    <SupportTeamMemberSearch snapshot={snapshot} teamName={teamName} label={t("addMember")} value={selected} onSelect={(id) => { setSelected(id); if (!pending) interactions.onMove(id, team.id); }} eligible={(id) => !pending && !interactions.eligibility(id, team.id)} />
    {!canAdd && <p className="text-xs text-hq-fg-muted">{snapshot.canWrite && team.memberIds.length >= team.target ? t("teamFull") : t("readOnly")}</p>}
    <SupportErrorMessage code={error} />
    {dragged && <SupportErrorMessage code={dropError ?? undefined} reveal={false} />}
    {canRename && <div className="flex flex-wrap gap-2"><button className={supportButton} onClick={() => { setName(team.name ?? ""); setRenaming(!renaming); }}>{t("rename")}</button><button className={supportButton} onClick={() => setReplace(!replace)}>{t("replaceLead")}</button></div>}
    {renaming && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); interactions.onCommand({ ...renameCommand, name }, team.id); }}><label className="text-sm">{t("teamName")}<input className={supportInput} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></label><button className={supportButton} disabled={pending || !name.trim()}>{tr("battlePlan.actions.save")}</button></form>}
    {replace && <AppSelect value="" onChange={(leadId) => interactions.onCommand({ kind: "replaceLead", leadId, teamId: team.id, expectedVersion: snapshot.version }, team.id)} aria-label={t("replaceLead")} placeholder={t("leadRequired")} searchable combobox explicitSelection searchMode="fuzzy" searchPlaceholder={t("findMember")} noSearchResultsLabel={t("noMatches")} options={snapshot.roster.filter((member) => member.rank === 4 || member.rank === 5).map((member) => ({ value: member.id, label: member.name, disabled: pending || !interactions.canCommand({ kind: "replaceLead", leadId: member.id, teamId: team.id, expectedVersion: snapshot.version }) }))} />}
    <div className="max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain">
      {team.memberIds.map((id) => { const member = snapshot.roster.find((row) => row.id === id); if (!member) return null;
        const movable = [null, ...snapshot.teams.map((row) => row.id)].some((to) => !interactions.eligibility(id, to));
        return <SupportMemberChip key={id} member={member} display={display} highlighted={highlighted === id} draggable={movable && !pending} onDrag={setDragged} onDragEnd={() => setDragged(null)}>
          {movable && <div className="mt-2 flex flex-wrap gap-2"><AppSelect value="" onChange={(to) => interactions.onMove(id, to === "unsorted" ? null : to)} aria-label={`${t("moveMember")}: ${member.name}`} placeholder={t("moveMember")} disabled={pending} options={[{ value: "unsorted", label: t("removeMember"), disabled: !!interactions.eligibility(id, null) }, ...snapshot.teams.map((row) => ({ value: row.id, label: `${teamName(row.id)} · ${snapshot.roster.find((member) => member.id === row.leadId)?.name ?? t("unknown")}`, disabled: !!interactions.eligibility(id, row.id) }))]} /></div>}
          {snapshot.roster.some((other) => { const to = locationOf(snapshot, other.id); return to && !interactions.eligibility(id, to, other.id); }) && <button className={`${supportButton} mt-2`} onClick={() => setSwap(swap === id ? null : id)}>{t("swapMembers")}</button>}
          {swap === id && <SupportTeamMemberSearch snapshot={snapshot} teamName={teamName} label={t("swapMembers")} value="" eligible={(other) => { const to = locationOf(snapshot, other); return !!to && !pending && !interactions.eligibility(id, to, other); }} onSelect={(other) => interactions.onMove(id, locationOf(snapshot, other), other)} />}
          {renderMemberActions?.(id)}
        </SupportMemberChip>;
      })}
      {!team.memberIds.length && <p>{t("emptyTeam")}</p>}
    </div>
  </section>;
}
