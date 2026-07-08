/**
 * Parse OCR text lines from the in-game Power Details screen.
 */

import {
  matchThpLabel,
  parseIntegerToken,
  sumThpBreakdown,
  type ThpBreakdownKey,
} from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

export type ParsePowerDetailsResult = {
  heroPowerTotal: number | null;
  breakdown: Partial<ThpBreakdown>;
  complete: boolean;
};

const HERO_POWER_HEADER_RE = /hero\s*power/i;

function extractTrailingNumber(line: string): number | null {
  const parts = line.trim().split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const value = parseIntegerToken(parts[i]!);
    if (value != null) return value;
  }
  return null;
}

function splitLabelValue(line: string): { label: string; valuePart: string } {
  const colonIdx = line.indexOf(":");
  if (colonIdx >= 0) {
    return {
      label: line.slice(0, colonIdx).trim(),
      valuePart: line.slice(colonIdx + 1),
    };
  }
  const match = /^(.*?)([\d,][\d,.\s]*)$/.exec(line.trim());
  if (match) {
    return { label: match[1]!.trim(), valuePart: match[2]! };
  }
  return { label: line.trim(), valuePart: "" };
}

export function parsePowerDetailsLines(lines: string[]): ParsePowerDetailsResult {
  const breakdown: Partial<ThpBreakdown> = {};
  let heroPowerTotal: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    if (HERO_POWER_HEADER_RE.test(line) && heroPowerTotal == null) {
      const total = extractTrailingNumber(line);
      if (total != null) heroPowerTotal = total;
      continue;
    }

    const { label: labelPart, valuePart } = splitLabelValue(line);
    const key = matchThpLabel(labelPart);
    if (!key) continue;
    const value =
      parseIntegerToken(valuePart) ?? extractTrailingNumber(line);
    if (value != null) {
      breakdown[key] = value;
    }
  }

  const keys: ThpBreakdownKey[] = [
    "heroLevel",
    "decorationsAndBuildings",
    "gear",
    "exclusiveWeapons",
    "heroTier",
    "heroSkill",
    "wallOfHonor",
  ];
  const complete = keys.every((key) => typeof breakdown[key] === "number");
  if (heroPowerTotal == null && complete) {
    heroPowerTotal = sumThpBreakdown(breakdown as ThpBreakdown);
  }

  return { heroPowerTotal, breakdown, complete };
}

export function toThpBreakdown(
  partial: Partial<ThpBreakdown>,
): ThpBreakdown | null {
  const keys: ThpBreakdownKey[] = [
    "heroLevel",
    "decorationsAndBuildings",
    "gear",
    "exclusiveWeapons",
    "heroTier",
    "heroSkill",
    "wallOfHonor",
  ];
  if (!keys.every((key) => typeof partial[key] === "number")) {
    return null;
  }
  return partial as ThpBreakdown;
}
