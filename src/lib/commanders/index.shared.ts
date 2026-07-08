import type { MainSquadSource, MainSquadType } from "@/lib/commanders/main-squad.shared";
import type { summarizeByMainSquad } from "@/lib/commanders/team-builder.shared";

export type CommanderIndexRow = {
  ashedMemberId: string;
  memberName: string;
  allianceRank: number | null;
  allianceRankTitle: string | null;
  totalHeroPower: number;
  mainSquad: MainSquadType | null;
  mainSquadSource: MainSquadSource | null;
  highestBaseVr: number | null;
  /** Roster member bound to an HQ account via hq_member_links. */
  hqLinked: boolean;
  /** Discord OAuth is on a different HQ account than this member's commander link. */
  oauthIdentitySplit: boolean;
};

export type CommanderIndexHqLinkFilter = "all" | "linked" | "not_linked";

export function commanderIndexRowMatchesHqLinkFilter(
  row: Pick<CommanderIndexRow, "hqLinked">,
  filter: CommanderIndexHqLinkFilter,
): boolean {
  if (filter === "linked") return row.hqLinked;
  if (filter === "not_linked") return !row.hqLinked;
  return true;
}

export type CommanderIndexPayload = {
  seasonKey: string;
  rows: CommanderIndexRow[];
  summaryBySquad: ReturnType<typeof summarizeByMainSquad>;
  canEdit: boolean;
  canSelfReportMemberIds: string[];
};
