"use client";

import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { commandEligibility, draftBoardInteractions, locationOf, moveCommand, proposalBoardInteractions, workingProposalSnapshot } from "@/lib/support-teams/board-client.shared";
import { ProposalControls } from "./ProposalControls";
import { DraftControls } from "./DraftControls";
import { SupportTeamBoard } from "./SupportTeamBoard";
import { SupportTeamHistory } from "./SupportTeamHistory";
import { SupportErrorMessage, SupportTeamDisplaySettings } from "./SupportTeamControls";
import { useSupportClaimInvites } from "./SupportTeamClaimInvite";
import { useSupportTeamDraft, useSupportTeamLive, useSupportTeamProposals, type DisplayState } from "./useSupportTeamLive";
import type { BoardInteractions } from "./SupportTeamSlot";

export function SupportTeamClient({ initial, initialPreferences, canInvite }: { initial: SupportSnapshot; initialPreferences: DisplayState; canInvite: boolean }) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const live = useSupportTeamLive(initial, initialPreferences);
  const { snapshot } = live;
  const draft = useSupportTeamDraft(snapshot, live.refresh);
  const proposals = useSupportTeamProposals(snapshot, live.refresh);
  const locale = useLocale();
  const claims = useSupportClaimInvites(snapshot, canInvite);
  const commandFor = (memberId: string, to: string | null, otherMemberId?: string): SupportCommand => {
    const from = locationOf(snapshot, memberId);
    return otherMemberId && from && to ? { kind: "swap", memberId, otherMemberId, from, to, expectedVersion: snapshot.version } : moveCommand(snapshot, memberId, to);
  };
  const interactions: BoardInteractions = {
    eligibility: (memberId, to, otherMemberId) => commandEligibility(snapshot, commandFor(memberId, to, otherMemberId)),
    onMove: (memberId, to, otherMemberId) => { void live.execute(commandFor(memberId, to, otherMemberId), to ?? "unsorted"); },
    canCommand: (command) => commandEligibility(snapshot, command) === null,
    onCommand: (command, slot) => { void live.execute(command, slot); },
  };
  const proposalActive = !!snapshot.actor?.canRead && !!proposals.selected;
  const proposalOptions = proposals.proposals.map((proposal, index) => ({ value: proposal.id, label: `${t("proposals.title")} · ${(index + 1).toLocaleString(locale)} · ${tr(proposal.phase === "published" ? "supportTeams.proposals.publish" : proposal.phase === "canceled" ? "timeOff.officerModal.cancel" : proposal.phase === "submitted" ? "supportTeams.proposals.submit" : "supportTeams.proposals.create")}` }));
  if (proposals.selected && !proposalOptions.some((option) => option.value === proposals.selected)) proposalOptions.push({ value: proposals.selected, label: t("proposals.title") });
  return <main className="mx-auto max-w-[110rem] space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p></header>
    <p className="max-w-3xl text-sm text-hq-fg-muted">{t("balanceHint")}</p>
    {!snapshot.canWrite && <p>{t("readOnly")}</p>}
    <div role="status" aria-live="polite" className="text-sm">{live.pending ? tr("common.loading") : live.notice ? t("saved") : snapshot.actor?.canRead && !live.connected ? tr("common.connecting") : null}</div>
    <SupportErrorMessage code={live.errors.connection} />
    <SupportTeamDisplaySettings display={live.preferences.display} saving={live.pending === "preferences"} disabled={!!live.pending} onChange={(next) => void live.savePreferences(next)} error={live.errors.preferences} />
    <SupportErrorMessage code={draft.error} />
    <SupportErrorMessage code={proposals.error} />
    {snapshot.actor?.canRead && <AppSelect value={proposals.selected ?? ""} onChange={proposals.select} aria-label={t("proposals.title")} placeholder={t("proposals.title")} options={[{ value: "", label: t("title") }, ...proposalOptions]} />}
    {snapshot.actor?.canRead && <ProposalControls snapshot={proposals.snapshot} publishedVersion={snapshot.version} canCreate={snapshot.canWrite && snapshot.board?.construction?.kind !== "draft"} onRefresh={proposals.refresh} onCreated={proposals.select} renderBoard={draft.active ? undefined : (adapter) => <SupportTeamBoard snapshot={workingProposalSnapshot(adapter.snapshot, snapshot.linkedMemberIds)} display={live.preferences.display} interactions={proposalBoardInteractions(adapter, snapshot, (command, slot) => { void live.execute(command, slot); })} pending={live.pending} pendingTeamIds={adapter.pendingTeamIds} errors={live.errors} renderSlotControls={adapter.renderSlotControls} renderMemberActions={claims.renderMemberActions}>
      <SupportTeamHistory snapshot={{ ...snapshot, version: adapter.snapshot.version, teams: workingProposalSnapshot(adapter.snapshot, snapshot.linkedMemberIds).teams }} onChanged={proposals.refresh} />
    </SupportTeamBoard>} />}
    {snapshot.actor?.canRead && <DraftControls key={draft.key ?? snapshot.board?.allianceId} snapshot={draft.snapshot} publishedVersion={snapshot.version} canManage={!!snapshot.actor.override && snapshot.canWrite} canSchedule={snapshot.canWrite && !snapshot.board?.construction} onRefresh={draft.refresh} onCreated={() => live.refresh()} renderBoard={(adapter) => <SupportTeamBoard snapshot={adapter.workingDraftSnapshot} display={live.preferences.display} interactions={draftBoardInteractions(adapter, snapshot, (command, slot) => { void live.execute(command, slot); })} pending={live.pending} pendingTeamIds={adapter.pendingTeamIds} errors={live.errors} renderSlotControls={adapter.renderSlotControls} mobileStatus={adapter.status} renderMemberActions={claims.renderMemberActions}>
      {adapter.status}
      <SupportTeamHistory snapshot={{ ...snapshot, version: adapter.snapshot.version, teams: adapter.workingDraftSnapshot.teams }} onChanged={draft.refresh} />
    </SupportTeamBoard>} />}
    {draft.active && !draft.snapshot && <p role="status">{tr("common.loading")}</p>}
    {proposalActive && !proposals.snapshot && !draft.active && <p role="status">{tr("common.loading")}</p>}
    {!draft.active && !proposalActive && <SupportTeamBoard snapshot={snapshot} display={live.preferences.display} interactions={interactions} pending={live.pending} errors={live.errors} renderMemberActions={claims.renderMemberActions}>
      {snapshot.actor?.canRead && <SupportTeamHistory snapshot={snapshot} onChanged={live.refresh} />}
    </SupportTeamBoard>}
    {claims.dialog}
  </main>;
}
