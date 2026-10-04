/**
 * Conflict resolution for commander season VR summary writes.
 *
 * Season highs must not lose a concurrent higher write. Intentional downgrades
 * (validated upstream against the caller's read of the prior high) apply only
 * when the stored row still matches that read — otherwise a stale lower write
 * would clobber a newer higher value.
 */
export function shouldApplySeasonVrWrite(input: {
  incomingBaseVr: number;
  storedHighestBaseVr: number;
  expectedPreviousBaseVr: number | null;
}): boolean {
  if (input.incomingBaseVr >= input.storedHighestBaseVr) {
    return true;
  }
  return (
    input.expectedPreviousBaseVr != null &&
    input.storedHighestBaseVr === input.expectedPreviousBaseVr
  );
}
