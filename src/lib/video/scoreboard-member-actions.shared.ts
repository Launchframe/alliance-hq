/** Scoreboard review: create unmatched OCR names, or apply OCR as a manual match's current name. */

export const SCOREBOARD_MANUAL_MATCH_METHOD = "manual";

export type ScoreboardMemberOfferRow = {
  id: string;
  deleted?: number | boolean | null;
  ocrName: string;
  memberId: string | null;
  memberName: string | null;
  matchMethod: string | null;
};

export type ScoreboardMemberOption = {
  id: string;
  current_name: string;
};

export function normalizeScoreboardMemberName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function scoreboardOcrNameDiffersFromMember(
  ocrName: string,
  currentName: string | null | undefined,
): boolean {
  const ocr = normalizeScoreboardMemberName(ocrName);
  const current = normalizeScoreboardMemberName(currentName ?? "");
  return ocr.length > 0 && current.length > 0 && ocr !== current;
}

function isActiveScoreboardRow(row: ScoreboardMemberOfferRow): boolean {
  return row.deleted !== 1 && row.deleted !== true;
}

export function scoreboardRowOffersCreate(
  row: ScoreboardMemberOfferRow,
  offerCreate: boolean,
): boolean {
  if (!offerCreate || !isActiveScoreboardRow(row)) return false;
  if (row.memberId) return false;
  return normalizeScoreboardMemberName(row.ocrName).length > 0;
}

export function scoreboardRowOffersRename(
  row: ScoreboardMemberOfferRow,
  members: ScoreboardMemberOption[],
  offerRename: boolean,
): boolean {
  if (!offerRename || !isActiveScoreboardRow(row)) return false;
  if (!row.memberId) return false;
  if (row.matchMethod !== SCOREBOARD_MANUAL_MATCH_METHOD) return false;
  const member = members.find((item) => item.id === row.memberId);
  const currentName = member?.current_name ?? row.memberName;
  return scoreboardOcrNameDiffersFromMember(row.ocrName, currentName);
}

export function scoreboardCreateRowIds(
  rows: ScoreboardMemberOfferRow[],
  offerCreate: boolean,
): string[] {
  return rows
    .filter((row) => scoreboardRowOffersCreate(row, offerCreate))
    .map((row) => row.id);
}

export function scoreboardRenameRowIds(
  rows: ScoreboardMemberOfferRow[],
  members: ScoreboardMemberOption[],
  offerRename: boolean,
): string[] {
  return rows
    .filter((row) => scoreboardRowOffersRename(row, members, offerRename))
    .map((row) => row.id);
}

export function nextPreviousNames(
  currentName: string,
  previousNames: string[],
  nextName: string,
): string[] {
  if (currentName === nextName) return previousNames;
  if (previousNames.includes(currentName)) return previousNames;
  return [...previousNames, currentName];
}
