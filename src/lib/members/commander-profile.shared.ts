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
    powerLevel: string | null;
    totalHeroPower: number | null;
    memberLevel: number | null;
    mainSquad: MainSquadType | null;
    mainSquadSource: MainSquadSource | null;
    canEditMainSquad: boolean;
    /** Viewer linked this commander via name+UID (self-report path). */
    viewerIsOwner: boolean;
    /** Viewer has members:write (officer override path). */
    canOfficerOverrideMainSquad: boolean;
    /** Viewer may generate a commander claim invite for this roster member. */
    viewerCanIssueClaimInvite: boolean;
    /** Viewer (alliance owner or platform maintainer) may break-glass unlink. */
    viewerCanBreakGlassUnlink: boolean;
    /** Viewer may open Last War store to gift bricks to this peer Commander. */
    canGiftStoreBricks: boolean;
    /** Viewer may create/manage tip-jar badge for this Commander (own linked). */
    canManageTipJar: boolean;
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
  commendations: Array<{
    id: string;
    commendationType: string | null;
    notes: string | null;
    recordedDate: string | null;
  }>;
  violations: Array<{
    id: string;
    violationType: string | null;
    notes: string | null;
    recordedDate: string | null;
    expungedAt: string | null;
  }>;
  trainHighlights: Array<{
    date: string;
    role: "conductor" | "vip" | "substitute";
    lockedAt: string | null;
  }>;
  operatingMode: "ashed" | "native";
};
