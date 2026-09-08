"use client";

import { useTranslations } from "next-intl";
import type { SupportCommand, SupportSnapshot } from "@/lib/support-teams/types.shared";
import { commandEligibility, locationOf, moveCommand } from "@/lib/support-teams/board-client.shared";
import { SupportTeamBoard } from "./SupportTeamBoard";
import { SupportTeamHistory } from "./SupportTeamHistory";
import { SupportErrorMessage, SupportTeamDisplaySettings } from "./SupportTeamControls";
import { useSupportClaimInvites } from "./SupportTeamClaimInvite";
import { useSupportTeamLive, type DisplayState } from "./useSupportTeamLive";
import type { BoardInteractions } from "./SupportTeamSlot";

export function SupportTeamClient({ initial, initialPreferences, canInvite }: { initial: SupportSnapshot; initialPreferences: DisplayState; canInvite: boolean }) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const live = useSupportTeamLive(initial, initialPreferences);
  const { snapshot } = live;
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
  return <main className="mx-auto max-w-[110rem] space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p></header>
    <p className="max-w-3xl text-sm text-hq-fg-muted">{t("balanceHint")}</p>
    {!snapshot.canWrite && <p>{t("readOnly")}</p>}
    <div role="status" aria-live="polite" className="text-sm">{live.pending ? tr("common.loading") : live.notice ? t("saved") : snapshot.actor?.canRead && !live.connected ? tr("common.connecting") : null}</div>
    <SupportErrorMessage code={live.errors.connection} />
    <SupportTeamDisplaySettings display={live.preferences.display} saving={live.pending === "preferences"} disabled={!!live.pending} onChange={(next) => void live.savePreferences(next)} error={live.errors.preferences} />
    <SupportTeamBoard snapshot={snapshot} display={live.preferences.display} interactions={interactions} pending={live.pending} errors={live.errors} renderMemberActions={claims.renderMemberActions}>
      {snapshot.actor?.canRead && <SupportTeamHistory snapshot={snapshot} onChanged={live.refresh} />}
    </SupportTeamBoard>
    {claims.dialog}
  </main>;
}
