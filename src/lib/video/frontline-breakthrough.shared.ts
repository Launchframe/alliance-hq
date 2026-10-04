import {
  normalizeName,
  sanitizedNameKey,
  unwrapOcrPayload,
  type OcrEntry,
} from "@/lib/video/normalize-rows";
import type { MatchedParseEntry } from "@/lib/video/parse-row-dedup";

export const FRONTLINE_BREAKTHROUGH_TARGET = "frontline-breakthrough";

export const FRONTLINE_BREAKTHROUGH_OCR_SCHEMA = {
  type: "object",
  properties: {
    selectedTab: {
      type: "string",
      enum: ["alliance", "warzone", "master", "unknown"],
      description: "The actively selected, highlighted ranking tab. All three labels can be visible simultaneously; do not report alliance merely because its label is visible. Use unknown when the selected tab is not legible.",
    },
    entries: {
      type: "array",
      description: "Complete visible player results on the selected ranking tab, including podium cards, scrolling list rows and the pinned self row. Do not invent offscreen or obscured rows. Keep stage, score, name and rank from the same player region.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Player name, retaining Unicode and name digits. Exclude avatar text, stage labels and alliance decorations." },
          stage: { type: ["integer", "null"], description: "The number after Stage (or its localized label). Null if unreadable. Not the score and not always 5." },
          score: { type: "string", description: "The integer after x or the multiplication sign beside the small blue soldier icon. Exclude Stage, trophy rank and orange thumbs-up counts." },
          rank: { type: ["integer", "null"], description: "Observed leaderboard rank. Podium center is 1, left is 2, right is 3. List/footer rank is at the left. Never use the orange thumbs-up count or renumber a partial list. Null if unreadable." },
        },
        required: ["name", "stage", "score", "rank"],
      },
    },
  },
  required: ["selectedTab", "entries"],
};

export type FrontlineEntry = OcrEntry & { frontlineStage: number | null };

export function frontlinePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647
    ? parsed
    : null;
}

export function normalizeFrontlineScore(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
  const text = String(value).trim().replace(/^[xX×]\s*/u, "");
  if (!/^\d+$/.test(text) && !/^\d{1,3}(?:,\d{3})+$/.test(text) &&
      !/^\d{1,3}(?:\.\d{3})+$/.test(text) && !/^\d{1,3}(?:[ \u00a0]\d{3})+$/.test(text)) return null;
  const score = Number(text.replace(/[, .\u00a0]/g, ""));
  return Number.isSafeInteger(score) && score >= 0 ? String(score) : null;
}

export function extractFrontlineEntries(payload: unknown): FrontlineEntry[] {
  const root = unwrapOcrPayload(payload);
  if (root?.selectedTab !== "alliance" || !Array.isArray(root.entries)) return [];
  return root.entries.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (typeof row.name !== "string") return [];
    const name = normalizeName(row.name);
    const score = normalizeFrontlineScore(row.score);
    if (!name || score == null) return [];
    const rank = frontlinePositiveInteger(row.rank);
    return [{ name, score, frontlineStage: frontlinePositiveInteger(row.stage), ...(rank == null ? {} : { rank }) }];
  });
}

function resultTuple(entry: OcrEntry): string {
  return JSON.stringify([entry.frontlineStage ?? null, normalizeFrontlineScore(entry.score), entry.rank ?? null]);
}

export function collapseFrontlineEntries(entries: OcrEntry[], allianceTag?: string | null): {
  entries: OcrEntry[];
  unresolvedConflicts: string[];
} {
  const unique = new Map<string, OcrEntry>();
  const results = new Map<string, Set<string>>();
  for (const entry of entries) {
    const name = sanitizedNameKey(entry.name, allianceTag);
    if (!name) continue;
    const tuple = resultTuple(entry);
    const key = JSON.stringify([name, tuple]);
    const previous = unique.get(key);
    if (!previous || (entry._sourceFrameIndex ?? Infinity) < (previous._sourceFrameIndex ?? Infinity)) {
      unique.set(key, entry);
    }
    const tuples = results.get(name) ?? new Set<string>();
    tuples.add(tuple);
    results.set(name, tuples);
  }
  const unresolvedConflicts = [...results].filter(([, tuples]) => tuples.size > 1).map(([name]) => name);
  const conflicts = new Set(unresolvedConflicts);
  return {
    entries: [...unique.values()].map((entry) => ({
      ...entry,
      scoreConflict: conflicts.has(sanitizedNameKey(entry.name, allianceTag)),
    })),
    unresolvedConflicts,
  };
}

export function dedupeFrontlineMatchedEntries(rows: MatchedParseEntry[], allianceTag?: string | null): MatchedParseEntry[] {
  const unique = new Map<string, MatchedParseEntry>();
  for (const row of rows) {
    const identity = row.match.memberId && row.match.confidence >= 0.9
      ? ["member", row.match.memberId]
      : ["name", row.match.memberId, sanitizedNameKey(row.entry.name, allianceTag)];
    const key = JSON.stringify([identity, resultTuple(row.entry)]);
    const previous = unique.get(key);
    if (!previous || (row.entry._sourceFrameIndex ?? Infinity) < (previous.entry._sourceFrameIndex ?? Infinity)) unique.set(key, row);
  }
  return [...unique.values()];
}

export type FrontlineReviewFields = {
  frontlineStage?: number | null;
  score?: string | null;
  rank?: number | null;
};

export function frontlineRowIssues(row: FrontlineReviewFields): Array<"stage" | "score" | "rank"> {
  const issues: Array<"stage" | "score" | "rank"> = [];
  if (frontlinePositiveInteger(row.frontlineStage) == null) issues.push("stage");
  if (normalizeFrontlineScore(row.score) == null) issues.push("score");
  if (row.rank != null && frontlinePositiveInteger(row.rank) == null) issues.push("rank");
  return issues;
}

export function frontlineConflictRowIds(
  rows: Array<FrontlineReviewFields & { id: string; ocrName: string; memberId: string | null }>,
  allianceTag?: string | null,
): Set<string> {
  const matchedNames = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.memberId) continue;
    const name = sanitizedNameKey(row.ocrName, allianceTag);
    const ids = matchedNames.get(name) ?? new Set<string>();
    ids.add(row.memberId);
    matchedNames.set(name, ids);
  }
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const name = sanitizedNameKey(row.ocrName, allianceTag);
    const ids = matchedNames.get(name);
    const memberId = row.memberId ?? (ids?.size === 1 ? [...ids][0] : null);
    const key = memberId ? `member:${memberId}` : `name:${name}`;
    if (!memberId && !name) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const conflicts = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((row) => JSON.stringify([row.frontlineStage ?? null, normalizeFrontlineScore(row.score), row.rank ?? null]))).size > 1) {
      for (const row of group) conflicts.add(row.id);
    }
  }
  return conflicts;
}
