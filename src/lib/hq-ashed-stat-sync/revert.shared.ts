/** Restore target after discarding a single HQ stat event. */

export function resolveRestoreTotalAfterDiscardEvent(input: {
  previousTotal: number | null | undefined;
}): number | null {
  const restore = input.previousTotal;
  if (restore == null || !Number.isFinite(restore) || !(restore > 0)) {
    return null;
  }
  return Math.round(restore);
}
