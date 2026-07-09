import { parsePowerLevelString } from "@/lib/video/roster-extract";

/** Commander lifetime stats synced from Ashed or roster video OCR. */
export type CommanderPowerStats = {
  powerLevel?: string | null;
  currentTotalHeroPower?: number | null;
};

export function commanderThpTotal(
  commander: { currentTotalHeroPower?: number | null },
): number {
  if (
    typeof commander.currentTotalHeroPower === "number" &&
    commander.currentTotalHeroPower > 0
  ) {
    return Math.round(commander.currentTotalHeroPower);
  }
  return 0;
}

export function resolveThpTotalFromSnapshot(snapshot: {
  currentTotalHeroPower?: number | null;
}): number | null {
  if (
    typeof snapshot.currentTotalHeroPower === "number" &&
    snapshot.currentTotalHeroPower > 0
  ) {
    return Math.round(snapshot.currentTotalHeroPower);
  }
  return null;
}

export function commanderPowerLevelDisplay(
  commander: { powerLevel?: string | null },
): string {
  const value = commander.powerLevel?.trim();
  if (!value) return "—";
  return value;
}

export function parsePowerLevelM(powerLevel: string | null | undefined): number | null {
  const parsed = parsePowerLevelString(powerLevel ?? null);
  return parsed.heroPowerM;
}

export function formatThpDisplay(total: number): string {
  if (total <= 0) return "—";
  return total.toLocaleString();
}

export function formatPowerLevelM(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${value}M`;
}

/** Prefer explicit power_level string; fall back to legacy heroPowerM millions. */
export function normalizePowerLevelString(input: {
  powerLevel?: string | null;
  heroPowerM?: number | null;
}): string | null {
  const trimmed = input.powerLevel?.trim();
  if (trimmed) return trimmed;
  return formatPowerLevelM(input.heroPowerM);
}
