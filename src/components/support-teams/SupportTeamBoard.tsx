"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MemberBoard } from "@/components/member-board/MemberBoard";
import type { SupportSnapshot } from "@/lib/support-teams/types.shared";
import { matchesUnsortedFilters, type SupportDisplayPreferences, type UnsortedFilters } from "@/lib/support-teams/display-preferences.shared";
import { supportBoardData } from "@/lib/support-teams/board-client.shared";
import { SupportMemberDetails, SupportMemberIdentity } from "./SupportMemberChip";
import { SupportTeamHeader, SupportTeamMemberActions, SupportTeamSlotActions, type BoardInteractions } from "./SupportTeamSlot";
import { SupportErrorMessage, UnsortedFiltersControl } from "./SupportTeamControls";
import { SupportSetupControls } from "./SupportSetupControls";

type Props = {
  snapshot: SupportSnapshot; display: SupportDisplayPreferences; interactions: BoardInteractions; pending: string | null; errors: Record<string, string>; scope?: string;
  renderMemberActions?: (id: string) => ReactNode; renderSlotControls?: (teamId: string) => ReactNode; pendingTeamIds?: string[]; mobileStatus?: ReactNode; children?: ReactNode;
};
export function SupportTeamBoard(props: Props) {
  const { snapshot } = props;
  const scope = props.scope ?? JSON.stringify(["support-teams", snapshot.board?.allianceId, snapshot.actor?.principalId ?? snapshot.linkedMemberIds, snapshot.board?.construction?.id]);
  return <SupportTeamBoardAdapter key={scope} {...props} scope={scope} />;
}
function SupportTeamBoardAdapter({ snapshot, display, interactions, pending, errors, renderMemberActions, renderSlotControls, pendingTeamIds = [], mobileStatus, children, scope }: Props & { scope: string }) {
  const t = useTranslations("supportTeams");
  const tr = useTranslations();
  const locale = useLocale();
  const [filters, setFilters] = useState<UnsortedFilters>({});
  const [swaps, setSwaps] = useState<Record<string, string | null>>({});
  const teamName = (id: string | null) => id === null ? t("unsorted") : snapshot.teams.find((team) => team.id === id)?.name ?? t("defaultName", { number: (Math.max(0, snapshot.teams.findIndex((team) => team.id === id)) + 1).toLocaleString(locale) });
  const data = { ...supportBoardData(snapshot, teamName, t("unknown")), scope };
  return <MemberBoard data={data} locale={locale} interactions={interactions} activity={{ pending: !!pending, pendingGroupIds: pendingTeamIds, errors, poolError: errors.unsorted }} labels={{
    pool: t("unsorted"), search: tr("members.search"), findMember: t("findMember"), noMatches: t("noMatches"), memberUnavailable: t("memberUnavailable"),
    addMember: t("addMember"), moveMember: t("moveMember"), removeMember: t("removeMember"), emptyPool: t("emptyPool"), emptyGroup: t("emptyTeam"),
    groupName: t("teamName"), preferredGroup: t("myTeam"), noGroup: t("noTeam"), openPool: t("openPool"), closePool: t("closePool"),
    back: tr("common.back"), next: tr("common.next"), swipeHint: t("swipeHint"), close: tr("battlePlan.actions.close"),
  }} renderers={{
    member: (member) => <SupportMemberDetails member={member} display={display} />,
    memberIdentity: (member) => <SupportMemberIdentity member={member} />,
    memberActions: (member, group) => <>{group && <SupportTeamMemberActions snapshot={snapshot} memberId={member.id} teamName={teamName} interactions={interactions} pending={!!pending || pendingTeamIds.includes(group.id)} swap={swaps[group.id] === member.id} onToggleSwap={() => setSwaps((old) => ({ ...old, [group.id]: old[group.id] === member.id ? null : member.id }))} />}{renderMemberActions?.(member.id)}</>,
    groupHeader: (group, own) => <SupportTeamHeader snapshot={snapshot} team={group} teamName={teamName} own={own} />,
    groupActions: (group) => renderSlotControls?.(group.id),
    groupCommands: (group) => <SupportTeamSlotActions snapshot={snapshot} team={snapshot.teams.find((team) => team.id === group.id)!} teamName={teamName} interactions={interactions} pending={!!pending || pendingTeamIds.includes(group.id)} />,
    groupMessage: (group, canAdd) => !canAdd && <p className="text-xs text-hq-fg-muted">{snapshot.canWrite && group.memberIds.length >= group.target ? t("teamFull") : t("readOnly")}</p>,
    groupSummary: (group) => `${group.name} · ${t("size", { count: group.memberIds.length.toLocaleString(locale), target: group.target.toLocaleString(locale) })}`,
    error: (code, reveal) => <SupportErrorMessage code={code} reveal={reveal} />,
    filters: <UnsortedFiltersControl filters={filters} setFilters={setFilters} roster={snapshot.roster} />,
    matchesFilter: (member) => matchesUnsortedFilters(member, filters),
    mobileStatus,
    attributes: { member: (member) => ({ "data-support-member": member.id }), group: (group) => ({ "data-support-team": group.id }), pool: { "data-support-pool": true } },
    setup: snapshot.actor?.override && !snapshot.published && !snapshot.board?.construction && <SupportSetupControls snapshot={snapshot} interactions={interactions} pending={!!pending} error={errors.setup} />,
  }}>{children}</MemberBoard>;
}
