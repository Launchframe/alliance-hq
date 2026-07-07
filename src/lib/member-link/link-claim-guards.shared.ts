export type HqGameUidClaim = {
  hqUserId: string;
  ashedMemberId: string;
};

export type DiscordGameUidClaim = {
  discordUserId: string;
  ashedMemberId: string;
  hqUserId: string | null;
};

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
