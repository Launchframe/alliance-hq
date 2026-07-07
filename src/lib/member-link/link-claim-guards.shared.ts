export type HqGameUidClaim = {
  hqUserId: string;
  ashedMemberId: string;
};

export type DiscordGameUidClaim = {
  discordUserId: string;
  ashedMemberId: string;
  hqUserId: string | null;
};

export type GameUidClaimConflictKind =
  | "hq_other_user"
  | "discord_only"
  | "discord_other_hq"
  | "same_user_different_member";

export function describeGameUidClaimConflict(input: {
  hqUserId: string;
  ashedMemberId: string;
  hqClaims: HqGameUidClaim[];
  discordClaims: DiscordGameUidClaim[];
}): GameUidClaimConflictKind | null {
  if (
    !hasConflictingHqGameUidClaim({
      hqUserId: input.hqUserId,
      ashedMemberId: input.ashedMemberId,
      hqClaims: input.hqClaims,
      discordClaims: input.discordClaims,
    })
  ) {
    return null;
  }

  const hqConflict = input.hqClaims.find(
    (claim) =>
      claim.hqUserId !== input.hqUserId ||
      claim.ashedMemberId !== input.ashedMemberId,
  );
  if (hqConflict) {
    if (hqConflict.hqUserId !== input.hqUserId) {
      return "hq_other_user";
    }
    return "same_user_different_member";
  }

  const discordConflict = input.discordClaims.find(
    (claim) =>
      claim.hqUserId !== input.hqUserId ||
      claim.ashedMemberId !== input.ashedMemberId,
  );
  if (!discordConflict) {
    return null;
  }
  if (discordConflict.hqUserId == null) {
    return "discord_only";
  }
  if (discordConflict.hqUserId !== input.hqUserId) {
    return "discord_other_hq";
  }
  return "same_user_different_member";
}

export function hasConflictingHqGameUidClaim(input: {
  hqUserId: string;
  ashedMemberId: string;
  hqClaims: HqGameUidClaim[];
  discordClaims: DiscordGameUidClaim[];
}): boolean {
  return (
    input.hqClaims.some(
      (claim) =>
        claim.hqUserId !== input.hqUserId ||
        claim.ashedMemberId !== input.ashedMemberId,
    ) ||
    input.discordClaims.some(
      (claim) =>
        claim.hqUserId !== input.hqUserId ||
        claim.ashedMemberId !== input.ashedMemberId,
    )
  );
}

export function hasConflictingDiscordGameUidClaim(input: {
  discordUserId: string;
  hqUserId: string | null;
  ashedMemberId: string;
  hqClaims: HqGameUidClaim[];
  discordClaims: DiscordGameUidClaim[];
}): boolean {
  return (
    input.discordClaims.some(
      (claim) =>
        claim.discordUserId !== input.discordUserId ||
        claim.ashedMemberId !== input.ashedMemberId,
    ) ||
    input.hqClaims.some(
      (claim) =>
        input.hqUserId == null ||
        claim.hqUserId !== input.hqUserId ||
        claim.ashedMemberId !== input.ashedMemberId,
    )
  );
}
