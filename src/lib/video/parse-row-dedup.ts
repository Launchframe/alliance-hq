import type { MemberMatch } from "@/lib/video/member-matcher";
import {
  normalizeScoreValue,
  type OcrEntry,
  stripParsedNameDecorations,
} from "@/lib/video/normalize-rows";

export type MatchedParseEntry = {
  entry: OcrEntry;
  match: MemberMatch;
};

function nameMatchScore(ocrName: string, memberName: string | null): number {
  if (!memberName) return 0;
  const a = stripParsedNameDecorations(ocrName).toLowerCase();
  const b = memberName.trim().toLowerCase();
  if (a === b) return 2;
  if (a.includes(b) || b.includes(a)) return 1;
  return 0;
}

function pickBestMatchedRow(
  group: MatchedParseEntry[],
  allianceTag?: string | null,
): MatchedParseEntry {
  const ranked = group
    .map((row) => ({
      row,
      frameIndex: row.entry._sourceFrameIndex ?? Number.MAX_SAFE_INTEGER,
      stripped: stripParsedNameDecorations(row.entry.name, allianceTag),
      hasBrackets: row.entry.name.includes("["),
      memberNameScore: nameMatchScore(row.entry.name, row.match.memberName),
    }))
    .sort((a, b) => {
      if (a.memberNameScore !== b.memberNameScore) {
        return b.memberNameScore - a.memberNameScore;
      }
      if (a.frameIndex !== b.frameIndex) {
        return a.frameIndex - b.frameIndex;
      }
      if (a.hasBrackets !== b.hasBrackets) {
        return a.hasBrackets ? 1 : -1;
      }
      return a.stripped.length - b.stripped.length;
    });

  const best = ranked[0]!;
  const earliestFrame = group.reduce<number | undefined>((min, row) => {
    const frame = row.entry._sourceFrameIndex;
    if (frame == null) return min;
    return min == null ? frame : Math.min(min, frame);
  }, undefined);

  return {
    entry: {
      ...best.row.entry,
      name: best.stripped || best.row.entry.name,
      _sourceFrameIndex: earliestFrame,
    },
    match: best.row.match,
  };
}

/**
 * After member matching, collapse rows that map to the same member with the
 * same score. OCR often yields different spellings across frames (e.g.
 * "SlAcKin" vs "SIAcKin") that sanitize to different names but match one member.
 */
export function dedupeMatchedParseEntries(
  rows: MatchedParseEntry[],
  allianceTag?: string | null,
): MatchedParseEntry[] {
  const unmatched: MatchedParseEntry[] = [];
  const byMemberScore = new Map<string, MatchedParseEntry[]>();

  for (const row of rows) {
    if (!row.match.memberId) {
      unmatched.push(row);
      continue;
    }

    const key = `${row.match.memberId}::${normalizeScoreValue(row.entry.score)}`;
    const group = byMemberScore.get(key) ?? [];
    group.push(row);
    byMemberScore.set(key, group);
  }

  const deduped: MatchedParseEntry[] = [...unmatched];
  for (const group of byMemberScore.values()) {
    deduped.push(
      group.length === 1
        ? group[0]!
        : pickBestMatchedRow(group, allianceTag),
    );
  }

  return deduped;
}
