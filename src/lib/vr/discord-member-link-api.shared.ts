/**
 * Officer-facing Discord member-link payloads must never include full player UID.
 * Platform maintainers use admin UID inspector for break-glass lookups.
 */
export function serializeDiscordMemberLinkForOfficerApi<
  T extends { gameUid: string },
>(link: T): Omit<T, "gameUid"> & { gameUidLast4: string } {
  const { gameUid, ...rest } = link;
  return {
    ...rest,
    gameUidLast4: gameUid.slice(-4),
  };
}
