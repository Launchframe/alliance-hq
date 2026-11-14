/** Scoreboard review: create unmatched OCR names, or apply OCR as a manual match's current name. */

import {
  MEMBER_FUZZY_AUTO_MATCH_MIN,
  nameMatchScore,
} from "@/lib/video/member-matcher";

export const SCOREBOARD_MANUAL_MATCH_METHOD = "manual";

/** API `code` when one confirm would store two names on the same member. */
export const SCOREBOARD_MEMBER_NAME_CONFLICT_CODE =
  "scoreboard_member_name_conflict";

/** Floor for Ashed “Did you mean…?” near-matches during scoreboard create. */
export const SCOREBOARD_ASHED_SUGGEST_MIN = MEMBER_FUZZY_AUTO_MATCH_MIN;

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

export type ScoreboardMemberActionRowInput = {
  id: string;
  confirmedName: string;
  bindAshedMemberId?: string;
  nameOverride?: boolean;
};

export type ScoreboardAshedNameCandidate = {
  id: string;
  name: string;
};

export type ScoreboardAshedNameSuggestion = ScoreboardAshedNameCandidate & {
  score: number;
};

export function normalizeScoreboardMemberName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function trimScoreboardConfirmedName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Exact + fuzzy Ashed matches for a confirmed create name.
 * Candidates already on the HQ roster are excluded.
 */
export function scoreboardAshedNameSuggestions(
  confirmedName: string,
  ashedMembers: ScoreboardAshedNameCandidate[],
  hqAshedMemberIds: ReadonlySet<string>,
  minScore: number = SCOREBOARD_ASHED_SUGGEST_MIN,
): {
  exact: ScoreboardAshedNameSuggestion | null;
  suggestions: ScoreboardAshedNameSuggestion[];
} {
  const needle = normalizeScoreboardMemberName(confirmedName);
  if (!needle) {
    return { exact: null, suggestions: [] };
  }

  const exactMatches: ScoreboardAshedNameSuggestion[] = [];
  const fuzzy: ScoreboardAshedNameSuggestion[] = [];

  for (const member of ashedMembers) {
    if (!member.id || hqAshedMemberIds.has(member.id)) continue;
    const name = trimScoreboardConfirmedName(member.name);
    const key = normalizeScoreboardMemberName(name);
    if (!key) continue;
    if (key === needle) {
      exactMatches.push({ id: member.id, name, score: 1 });
      continue;
    }
    const score = nameMatchScore(needle, key);
    if (score >= minScore) {
      fuzzy.push({ id: member.id, name, score });
    }
  }

  if (exactMatches.length > 1) {
    exactMatches.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    return { exact: null, suggestions: exactMatches.slice(0, 3) };
  }

  fuzzy.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { exact: exactMatches[0] ?? null, suggestions: fuzzy.slice(0, 3) };
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

export function sameScoreboardNameList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

/**
 * Previous names to store when a scoreboard confirm binds an Ashed member.
 * Keeps both histories and appends each current name that the new name replaces.
 */
export function previousNamesForScoreboardBind(input: {
  ashedCurrentName: string;
  ashedPreviousNames: readonly string[];
  hqCurrentName?: string | null;
  hqPreviousNames?: readonly string[];
  nextName: string;
}): string[] {
  let previous: string[] = [];
  for (const name of [
    ...input.ashedPreviousNames,
    ...(input.hqPreviousNames ?? []),
  ]) {
    const trimmed = trimScoreboardConfirmedName(name);
    if (!trimmed || previous.includes(trimmed)) continue;
    previous.push(trimmed);
  }
  const hqCurrent = trimScoreboardConfirmedName(input.hqCurrentName ?? "");
  if (hqCurrent) {
    previous = nextPreviousNames(hqCurrent, previous, input.nextName);
  }
  return nextPreviousNames(
    trimScoreboardConfirmedName(input.ashedCurrentName),
    previous,
    input.nextName,
  );
}

export function scoreboardAshedRenameNeedsSync(input: {
  remoteName: string;
  remotePreviousNames: readonly string[];
  nextName: string;
  nextPreviousNames: readonly string[];
}): boolean {
  return (
    trimScoreboardConfirmedName(input.remoteName) !== input.nextName ||
    !sameScoreboardNameList(input.remotePreviousNames, input.nextPreviousNames)
  );
}

export function scoreboardConfirmedNamesConflict(
  rows: Array<{ memberKey: string; confirmedName: string }>,
): boolean {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const prior = seen.get(row.memberKey);
    if (prior !== undefined && prior !== row.confirmedName) return true;
    seen.set(row.memberKey, row.confirmedName);
  }
  return false;
}
