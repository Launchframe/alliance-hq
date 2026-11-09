/**
 * Week chrome (prev/next, tabs, capture) must not lock solely for Ashed
 * auto-import. Matchup identity / day fields that Ashed would overwrite stay
 * busy while that import runs.
 */
export function resolveVsPerformanceBusyState(input: {
  hasDraft: boolean;
  loading: boolean;
  needsAutoPull: boolean;
  autoPulling: boolean;
}): { navLocked: boolean; matchupImportBusy: boolean } {
  return {
    navLocked: input.hasDraft || input.loading,
    matchupImportBusy: input.needsAutoPull || input.autoPulling,
  };
}
