export const VR_STEP = 250;
export const VR_MIN = 250;
/** Absolute ceiling for Discord slash registration; runtime caps use season max_base_vr. */
export const VR_MAX = 12750;
export const ANOMALY_GAP = 750;
export const ANOMALY_MIN_REPORTERS = 10;
export const OFFICER_REVIEW_THRESHOLD = 10250;

export function isValidBaseVr(vr: number, maxVr: number = VR_MAX): boolean {
  return (
    Number.isInteger(vr) &&
    vr >= VR_MIN &&
    vr <= maxVr &&
    vr % VR_STEP === 0
  );
}

export function nextBaseVr(current: number): number {
  return current + VR_STEP;
}

export function maxAllowedDowngrade(seasonHigh: number): number {
  return Math.max(VR_MIN, seasonHigh - VR_STEP);
}

export function formatVrValidationError(maxVr: number = VR_MAX): string {
  return `Base VR must be a whole number from ${VR_MIN} to ${maxVr} in steps of ${VR_STEP}.`;
}

export function initialBaseVrForBump(): number {
  return VR_MIN;
}
