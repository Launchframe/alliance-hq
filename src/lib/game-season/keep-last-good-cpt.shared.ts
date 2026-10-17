/**
 * When cpt-hedge sync misses or throws, age-fallback caps at season 4 and clears
 * post-season. If we already have a successful cpt-hedge sync for this server,
 * retain that last-good state instead of stomping every alliance on the server.
 */
export function shouldRetainLastGoodCptSeason(input: {
  cptRecordFound: boolean;
  priorSeasonKeySource: string | null | undefined;
  priorSeasonKeySynced: string | null | undefined;
}): boolean {
  if (input.cptRecordFound) return false;
  const source = input.priorSeasonKeySource?.trim();
  const synced = input.priorSeasonKeySynced?.trim();
  return source === "cpt-hedge" && Boolean(synced);
}
