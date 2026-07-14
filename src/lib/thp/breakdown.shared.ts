import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

export const THP_BREAKDOWN_KEYS = [
  "heroLevel",
  "decorationsAndBuildings",
  "gear",
  "exclusiveWeapons",
  "heroTier",
  "heroSkill",
  "wallOfHonor",
] as const;

export type ThpBreakdownKey = (typeof THP_BREAKDOWN_KEYS)[number];

/** OCR / in-game label aliases → breakdown key. */
export const THP_LABEL_ALIASES: ReadonlyArray<{
  key: ThpBreakdownKey;
  patterns: RegExp[];
}> = [
  { key: "heroLevel", patterns: [/^hero\s*level\b/i] },
  {
    key: "decorationsAndBuildings",
    patterns: [
      /^decorations?\s*(?:&|and)\s*building(?:\s*stats?)?\b/i,
      /^decorations?\s*and\s*buildings?\b/i,
    ],
  },
  { key: "gear", patterns: [/^gear\b/i] },
  {
    key: "exclusiveWeapons",
    patterns: [/^exclusive\s*weapons?\b/i],
  },
  {
    key: "heroTier",
    patterns: [
      /^hero\s*tier\b/i,
      /^her[o0]\s*t[il1]er\b/i,
      /^hero\s*tief\b/i,
      /^hero\s*tie[rn]\b/i,
    ],
  },
  { key: "heroSkill", patterns: [/^hero\s*skill\b/i, /^hera\s*skill\b/i] },
  { key: "wallOfHonor", patterns: [/^wall\s*of\s*honou?r\b/i] },
];

export function sumThpBreakdown(breakdown: ThpBreakdown): number {
  return THP_BREAKDOWN_KEYS.reduce((sum, key) => sum + breakdown[key], 0);
}

export function isThpBreakdown(value: unknown): value is ThpBreakdown {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return THP_BREAKDOWN_KEYS.every(
    (key) => typeof record[key] === "number" && Number.isFinite(record[key]),
  );
}

export function parseThpBreakdownInput(value: unknown): ThpBreakdown | null {
  if (!isThpBreakdown(value)) return null;
  const normalized = {} as ThpBreakdown;
  for (const key of THP_BREAKDOWN_KEYS) {
    const n = Math.round(value[key]);
    if (n < 0) return null;
    normalized[key] = n;
  }
  return normalized;
}

export function validateThpTotal(total: number): boolean {
  return Number.isFinite(total) && total > 0 && total <= 1_000_000_000;
}

export function breakdownsEqual(
  a: ThpBreakdown | null | undefined,
  b: ThpBreakdown | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return THP_BREAKDOWN_KEYS.every((key) => a[key] === b[key]);
}

export function matchThpLabel(line: string): ThpBreakdownKey | null {
  const normalized = line.trim().replace(/\s+/g, " ");
  for (const entry of THP_LABEL_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return entry.key;
    }
  }
  return null;
}

export function parseIntegerToken(token: string): number | null {
  const digits = token.replace(/,/g, "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}
