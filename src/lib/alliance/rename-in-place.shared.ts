/** Fraction of confirmed-active roster that would become former before we require explicit confirm. */
export const ROSTER_MASS_FORMER_CONFIRM_FRACTION = 0.3;

export function massFormerNeedsConfirm(input: {
  wouldFormerCount: number;
  confirmedActiveCount: number;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? ROSTER_MASS_FORMER_CONFIRM_FRACTION;
  if (input.wouldFormerCount <= 0) return false;
  if (input.confirmedActiveCount <= 0) return false;
  return (
    input.wouldFormerCount >=
    input.confirmedActiveCount * threshold
  );
}

export function normalizeAllianceTagInput(tag: string): string {
  return tag.trim();
}

export function normalizeAllianceNameInput(name: string): string {
  return name.trim();
}
