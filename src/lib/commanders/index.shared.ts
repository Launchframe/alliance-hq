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
};

export type CommanderIndexPayload = {
  seasonKey: string;
  rows: CommanderIndexRow[];
  summaryBySquad: ReturnType<typeof summarizeByMainSquad>;
  canEdit: boolean;
  canSelfReportMemberIds: string[];
};
