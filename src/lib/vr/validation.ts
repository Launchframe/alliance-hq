import {
  baseVrForInstituteLevel,
  coerceInstituteLevelFromBaseVr,
  formatBaseVrValidationError,
  formatInstituteLevelValidationError,
  instituteLevelForBaseVr,
  isValidBaseVrForSeason,
  isValidInstituteLevel,
  maxBaseVrForSeason,
  maxInstituteLevel,
  minBaseVrForSeason,
  minInstituteLevel,
  nextInstituteLevel,
  previousInstituteLevel,
  validateBaseVrForSeason,
  validateInstituteLevelForSeason,
} from "@/lib/vr/institute-levels.shared";

/** @deprecated Prefer season ladder; kept for Discord option registration ceiling. */
export const VR_STEP = 250;
export const VR_MIN = 100;
/** Absolute ceiling for Discord slash registration (S5 max). */
export const VR_MAX = 28000;
export const ANOMALY_GAP = 750;
export const ANOMALY_MIN_REPORTERS = 10;

export {
  baseVrForInstituteLevel,
  coerceInstituteLevelFromBaseVr,
  formatBaseVrValidationError,
  formatInstituteLevelValidationError,
  instituteLevelForBaseVr,
  isValidBaseVrForSeason,
  isValidInstituteLevel,
  maxBaseVrForSeason,
  maxInstituteLevel,
  minBaseVrForSeason,
  minInstituteLevel,
  nextInstituteLevel,
  previousInstituteLevel,
  validateBaseVrForSeason,
  validateInstituteLevelForSeason,
};

/** @deprecated Use isValidBaseVrForSeason(seasonKey, vr). */
export function isValidBaseVr(vr: number, maxVr: number = VR_MAX): boolean {
  return Number.isInteger(vr) && vr >= VR_MIN && vr <= maxVr;
}

export function nextBaseVrForSeason(
  seasonKey: string,
  currentVr: number | null,
): number | null {
  const currentLevel =
    currentVr == null || currentVr <= 0
      ? null
      : coerceInstituteLevelFromBaseVr(seasonKey, currentVr);
  const nextLevel = nextInstituteLevel(seasonKey, currentLevel);
  if (nextLevel == null) return null;
  return baseVrForInstituteLevel(seasonKey, nextLevel);
}

export function maxAllowedDowngradeForSeason(
  seasonKey: string,
  seasonHigh: number,
): number {
  const level = coerceInstituteLevelFromBaseVr(seasonKey, seasonHigh);
  const prev = previousInstituteLevel(seasonKey, level);
  return baseVrForInstituteLevel(seasonKey, prev) ?? minBaseVrForSeason(seasonKey);
}

export function initialBaseVrForBump(seasonKey: string): number {
  return minBaseVrForSeason(seasonKey);
}

/** @deprecated Use formatBaseVrValidationError(validateBaseVrForSeason(...)). */
export function formatVrValidationError(maxVr: number = VR_MAX): string {
  return `Enter a value between ${VR_MIN} and ${maxVr}.`;
}
