export type MemberLinkClaimConflictReason =
  | "name_collision"
  | "commander_taken"
  | "server_mismatch"
  | "target_mismatch";

export type HelpRequestClaimContact = {
  email: string | null;
  displayName: string | null;
  memberDisplayName: string | null;
};

export type HelpRequestRosterRow = {
  ashedMemberId: string;
  currentName: string;
  nameMatchHint: boolean;
  claim: {
    hq?: HelpRequestClaimContact;
    discord?: { username: string | null };
  } | null;
};

export type MemberLinkHelpRequestReview = {
  request: {
    id: string;
    allianceId: string;
    allianceTag: string | null;
    allianceName: string | null;
    origin: string;
    context: string;
    claimConflictReason: MemberLinkClaimConflictReason | null;
    reportedName: string | null;
    gameUserName: string | null;
    gameUidLast4: string | null;
    status: string;
    createdAt: Date;
    hqUserId: string | null;
    discordUsername: string | null;
    requesterHandle: string;
  };
  requester: {
    email: string | null;
    displayName: string | null;
    discordUsername: string | null;
    requesterHandle: string;
  };
  roster: {
    unclaimed: HelpRequestRosterRow[];
    claimed: HelpRequestRosterRow[];
  };
};
