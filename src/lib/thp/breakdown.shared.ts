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
  {
    key: "heroLevel",
    patterns: [
      /^hero\s*level\b/i,
      // German: "Heldenlevel".
      /^helden\s*level\b/i,
      // Brazilian Portuguese: "Nível do Herói" (accents often dropped by OCR).
      /^n[ií]vel\s*do\s*her[oó]i\b/i,
      // Korean: "영웅 레벨".
      /^영웅\s*레벨/,
    ],
  },
  {
    key: "decorationsAndBuildings",
    patterns: [
      /^decorations?\s*(?:&|and)\s*building(?:\s*stats?)?\b/i,
      /^decorations?\s*and\s*buildings?\b/i,
      // German: "Dekorationen und Gebäudestatistiken" — the label often wraps
      // across two OCR lines, so match on the (more legible) second half too.
      /^dekorationen\b/i,
      /geb[äa]udestatistiken/i,
      // Brazilian Portuguese: "Decorações e Atributos de Construção" — long
      // label that frequently wraps; match either half.
      /^decora[cç][oõ]es\b/i,
      /atributos\s*de\s*constru/i,
      // Korean: "장식 및 건물 능력치" — may wrap after "장식 및".
      /^장식/,
      /건물\s*능력치/,
    ],
  },
  {
    key: "gear",
    patterns: [
      /^gear\b/i,
      // German: "Ausrüstung" — OCR often drops diacritics or doubles i→ii.
      /^ausr[uü]stung\b/i,
      /^ausriistung\b/i,
      // Brazilian Portuguese: "Equipamento".
      /^equipamento\b/i,
      // Korean: "장비".
      /^장비/,
    ],
  },
  {
    key: "exclusiveWeapons",
    patterns: [
      /^exclusive\s*weapons?\b/i,
      // German: "Exklusive Waffe".
      /^exklusive\s*waffen?\b/i,
      // Brazilian Portuguese: "Arma Exclusiva".
      /^arma\s*exclusiva\b/i,
      // Korean: "전속 무기".
      /^전속\s*무기/,
    ],
  },
  {
    key: "heroTier",
    patterns: [
      /^hero\s*tier\b/i,
      /^her[o0]\s*t[il1]er\b/i,
      /^hero\s*tief\b/i,
      /^hero\s*tie[rn]\b/i,
      // German: "Heldenrang".
      /^helden\s*rang\b/i,
      // Brazilian Portuguese: "Categoria de Herói".
      /^categoria\s*de\s*her[oó]i\b/i,
      // Korean: "영웅 티어".
      /^영웅\s*티어/,
    ],
  },
  {
    key: "heroSkill",
    patterns: [
      /^hero\s*skill\b/i,
      /^hera\s*skill\b/i,
      // German: "Helden-Fähigkeit" — the umlaut is often dropped (ascii-fold)
      // or misread as a doubled "ii".
      /^helden[\s-]*f[äa]higkeit\b/i,
      /^helden[\s-]*fiihigkeit\b/i,
      // Brazilian Portuguese: "Habilidade de Herói".
      /^habilidade\s*de\s*her[oó]i\b/i,
      // Korean: "영웅 스킬".
      /^영웅\s*스킬/,
    ],
  },
  {
    key: "wallOfHonor",
    patterns: [
      /^wall\s*of\s*honou?r\b/i,
      // German: "Ehrenwand".
      /^ehrenwand\b/i,
      // Brazilian Portuguese: "Mural de Honra".
      /^mural\s*de\s*honra\b/i,
      // Korean: "명예의 전당".
      /^명예의?\s*전당/,
    ],
  },
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
