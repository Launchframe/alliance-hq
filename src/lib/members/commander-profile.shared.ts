import type {
  MainSquadSource,
  MainSquadType,
} from "@/lib/commanders/main-squad.shared";

export type CommanderProfilePayload = {
  member: {
    ashedMemberId: string;
    currentName: string;
    previousNames: string[];
    status: string;
    rankLabel: string;
    titleLabel: string;
    heroPowerM: number | null;
    memberLevel: number | null;
    mainSquad: MainSquadType | null;
    mainSquadSource: MainSquadSource | null;
    canEditMainSquad: boolean;
    /** Viewer linked this commander via name+UID (self-report path). */
    viewerIsOwner: boolean;
    /** Viewer has members:write (officer override path). */
    canOfficerOverrideMainSquad: boolean;
    /** Present only when the viewer is the HQ user who linked this commander. */
    gameUid: string | null;
  };
  alliance: {
    id: string;
    tag: string | null;
    name: string | null;
    slug: string;
  };
  hqUser: {
    id: string;
    displayName: string | null;
    email: string | null;
  } | null;
  discordLinks: Array<{
    discordUserId: string;
    discordUsername: string | null;
    linkedAt: string;
  }>;
  tenureHistory: Array<{
    allianceId: string;
    allianceTag: string | null;
    allianceName: string | null;
    ashedMemberId: string;
    joinedAt: string;
    leftAt: string | null;
    isCurrent: boolean;
  }>;
  rankTimeline: Array<{
    id: string;
    allianceRank: number;
    allianceRankTitle: string | null;
    effectiveDate: string;
    source: string;
  }>;
  vrHistory: Array<{
    seasonKey: string;
    highestBaseVr: number;
    updatedAt: string;
  }>;
  eventScores: Array<{
    eventId: string;
    eventName: string;
    boardKey: string | null;
    score: number | null;
    rank: number | null;
    updatedAt: string;
  }>;
  commendations: Record<string, unknown>[];
  violations: Record<string, unknown>[];
  trainHighlights: Array<{
    date: string;
    role: "conductor" | "vip" | "substitute";
    lockedAt: string | null;
  }>;
  operatingMode: "ashed" | "native";
};
