/**
 * Cross-alliance UID ownership. Alliance-scoped unique indexes do not stop a
 * second HQ/Discord principal from binding the same Last War UID in another
 * alliance. Once any principal has claimed a UID, name+UID must not attach a
 * different principal (player-uid-privacy first-claim rule).
 */

export type GlobalGameUidDiscordClaim = {
  discordUserId: string;
  hqUserId: string | null;
};

/**
 * Returns true when existing claims/owners belong to someone other than the
 * linking principal. Same-principal multi-alliance links are allowed.
 */
export function hasConflictingGlobalGameUidPrincipal(input: {
  hqUserId?: string | null;
  discordUserId?: string | null;
  /**
   * HQ user bridged from the caller's Discord account (`discord_hq_links`),
   * when the caller is linking via Discord. Distinct from claims already on
   * this UID — needed so an HQ owner can Discord-link a UID they already hold
   * on the web.
   */
  callerDiscordHqUserId?: string | null;
  /** HQ users that already hold an hq_member_links row for this UID. */
  hqClaimHqUserIds: readonly string[];
  /** Discord member-link rows for this UID (with optional HQ bridge). */
  discordClaims: readonly GlobalGameUidDiscordClaim[];
  /** HQ users linked via hq_user_commanders for the UID-bound commander. */
  commanderOwnerHqUserIds: readonly string[];
}): boolean {
  const hqUserId = input.hqUserId?.trim() || null;
  const discordUserId = input.discordUserId?.trim() || null;
  const callerDiscordHqUserId = input.callerDiscordHqUserId?.trim() || null;

  if (hqUserId) {
    if (input.hqClaimHqUserIds.some((id) => id !== hqUserId)) return true;
    if (input.discordClaims.some((claim) => claim.hqUserId !== hqUserId)) {
      return true;
    }
    if (input.commanderOwnerHqUserIds.some((id) => id !== hqUserId)) {
      return true;
    }
    return false;
  }

  if (discordUserId) {
    if (
      input.discordClaims.some((claim) => claim.discordUserId !== discordUserId)
    ) {
      return true;
    }
    // Discord-only callers cannot take a UID already bound to any HQ account.
    // When the Discord user has a bridged HQ id, only that HQ account is allowed.
    if (
      input.hqClaimHqUserIds.some(
        (id) => callerDiscordHqUserId == null || id !== callerDiscordHqUserId,
      )
    ) {
      return true;
    }
    if (
      input.commanderOwnerHqUserIds.some(
        (id) => callerDiscordHqUserId == null || id !== callerDiscordHqUserId,
      )
    ) {
      return true;
    }
    return false;
  }

  return (
    input.hqClaimHqUserIds.length > 0 ||
    input.discordClaims.length > 0 ||
    input.commanderOwnerHqUserIds.length > 0
  );
}
