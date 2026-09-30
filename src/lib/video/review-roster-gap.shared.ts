export type ReviewRosterGapCode =
  | "roster_refresh_ashed"
  | "roster_ask_ashed_officer"
  | "roster_save_members";

/**
 * What to tell the officer when submitted member ids are missing from the
 * local roster. Does not sync. `roster_refresh_ashed` means an Ashed refresh
 * might add the member, and the review page starts that refresh after save.
 */
export function reviewRosterGapCode(input: {
  missingCount: number;
  operatingMode: "ashed" | "native";
  hasAshedSeat: boolean;
}): ReviewRosterGapCode | null {
  if (input.missingCount === 0) return null;
  if (input.operatingMode === "native") return "roster_save_members";
  if (!input.hasAshedSeat) return "roster_ask_ashed_officer";
  return "roster_refresh_ashed";
}
