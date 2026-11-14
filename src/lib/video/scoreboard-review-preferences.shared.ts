import { isOfficerOrAbove } from "@/lib/rbac/system-roles";

export type ScoreboardReviewPreferences = {
  offerCreate: boolean;
  offerRename: boolean;
};

export const DEFAULT_SCOREBOARD_REVIEW_PREFERENCES: ScoreboardReviewPreferences =
  {
    offerCreate: true,
    offerRename: true,
  };

export function normalizeScoreboardOfferFlag(value: unknown): boolean {
  return value === true;
}

export function canEditScoreboardReviewPreferences(input: {
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): boolean {
  return input.isPlatformMaintainer || isOfficerOrAbove(input.roleName);
}
