/**
 * `discord_bot_pending` is keyed only by discord user id (one global row).
 * Confirm/pick handlers must bind that row to the caller's alliance and, when
 * the UI knows which UID it showed, to that expected game UID — otherwise a
 * dual-tab or cross-guild overwrite silently links the wrong commander.
 */
export function discordBotPendingMatchesCaller(input: {
  pendingAllianceId: string;
  callerAllianceId: string;
  pendingGameUid?: string | null;
  expectedGameUid?: string | null;
}): boolean {
  if (input.pendingAllianceId !== input.callerAllianceId) {
    return false;
  }
  const expected = input.expectedGameUid?.trim();
  if (!expected) return true;
  const pendingUid = input.pendingGameUid?.trim() ?? "";
  return pendingUid === expected;
}

export function gameUidFromDiscordLinkPending(
  pending: { gameUid?: string | null } | null | undefined,
): string | null {
  const uid = pending?.gameUid?.trim();
  return uid || null;
}
