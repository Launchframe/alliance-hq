export type MemberLinkClaimConflictReason =
  | "name_collision"
  | "commander_taken"
  /** Legacy help rows only — claim confirm no longer emits server_mismatch. */
  | "server_mismatch"
  | "target_mismatch"
  | "discord_hq_unlinked";

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

/** Roster "name match" hints for officers — UID lookup only on claim conflicts. */
export function helpRequestRosterNameNeedles(input: {
  context: string;
  reportedName: string | null;
  gameUserName: string | null;
}): string[] {
  if (input.context === "claim_conflict" || input.context === "cross_layer_claim") {
    const lookup = input.gameUserName?.trim();
    return lookup ? [lookup] : [];
  }
  return [input.reportedName ?? "", input.gameUserName ?? ""]
    .map((value) => value.trim())
    .filter(Boolean);
}

/** In-game label for requester contact / mediation — not the invite target on claim conflicts. */
export function helpRequestRequesterInGameName(input: {
  context: string;
  reportedName: string | null;
  gameUserName: string | null;
  requesterHandle: string;
}): string {
  if (input.context === "claim_conflict" || input.context === "cross_layer_claim") {
    return (
      input.gameUserName?.trim() ||
      input.requesterHandle.trim() ||
      input.reportedName?.trim() ||
      ""
    );
  }
  return (
    input.reportedName?.trim() ||
    input.gameUserName?.trim() ||
    input.requesterHandle.trim() ||
    ""
  );
}

/** Client-side roster filter for officer help review (case-insensitive name substring). */
export function filterHelpRequestRosterRows<
  T extends Pick<HelpRequestRosterRow, "currentName">,
>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    row.currentName.toLowerCase().includes(needle),
  );
}

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
    /** Claim-conflict invite target (help row linkedAshedMemberId). */
    inviteTargetAshedMemberId: string | null;
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
