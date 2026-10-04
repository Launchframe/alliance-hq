import type {
  LastRankMatchResult,
} from "@/lib/lastrank/alliance-page.shared";

export type LastRankRosterDiff = {
  lastRankCount: number;
  hqActiveCount: number;
  matched: number;
  excessHq: string[];
  missingFromHq: string[];
  ambiguous: Array<{
    name: string;
    suggestions: Array<{ name: string; score: number }>;
  }>;
};

export function buildLastRankRosterDiff(input: {
  lastRankCount: number;
  match: LastRankMatchResult;
}): LastRankRosterDiff {
  const excessHq = input.match.unmatchedHq.map(
    (row) => row.currentNames[0] ?? row.previousNames[0] ?? row.ashedMemberId,
  );
  const missingFromHq: string[] = [];
  const ambiguous: LastRankRosterDiff["ambiguous"] = [];
  for (const row of input.match.unmatched) {
    if (row.status === "ambiguous") {
      ambiguous.push({
        name: row.lastRank.name,
        suggestions: row.suggestions.slice(0, 3).map((s) => ({
          name: s.name,
          score: s.score,
        })),
      });
    } else {
      missingFromHq.push(row.lastRank.name);
    }
  }
  const matched = input.match.matched.length;
  return {
    lastRankCount: input.lastRankCount,
    hqActiveCount: matched + excessHq.length,
    matched,
    excessHq,
    missingFromHq,
    ambiguous,
  };
}

export function formatLastRankRosterDiffText(input: {
  tag: string;
  gameServerNumber: number;
  diff: LastRankRosterDiff;
}): string {
  const { diff } = input;
  const lines = [
    `Roster diff vs LastRank (S${input.gameServerNumber} ${input.tag})`,
    `  LastRank members: ${diff.lastRankCount}`,
    `  HQ active:        ${diff.hqActiveCount}`,
    `  Matched:          ${diff.matched}`,
    `  Excess in HQ (not on LastRank): ${diff.excessHq.length}`,
    ...diff.excessHq.map((name) => `    - ${name}`),
    `  Missing from HQ (on LastRank only): ${diff.missingFromHq.length}`,
    ...diff.missingFromHq.map((name) => `    - ${name}`),
    `  Ambiguous: ${diff.ambiguous.length}`,
    ...diff.ambiguous.map((row) => {
      const tip =
        row.suggestions.length > 0
          ? ` (suggestions: ${row.suggestions
              .map((s) => `${s.name} ${s.score.toFixed(2)}`)
              .join(", ")})`
          : "";
      return `    - ${row.name}${tip}`;
    }),
  ];
  return lines.join("\n");
}
