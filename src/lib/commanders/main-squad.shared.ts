import { z } from "zod";

export const MAIN_SQUAD_TYPES = ["aircraft", "tank", "missile"] as const;

export type MainSquadType = (typeof MAIN_SQUAD_TYPES)[number];

export const MAIN_SQUAD_SOURCES = ["self_report", "officer_override"] as const;

export type MainSquadSource = (typeof MAIN_SQUAD_SOURCES)[number];

export const mainSquadTypeSchema = z.enum(MAIN_SQUAD_TYPES);

export function parseMainSquadType(value: unknown): MainSquadType | null {
  const parsed = mainSquadTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isMainSquadType(value: string | null | undefined): value is MainSquadType {
  return parseMainSquadType(value) != null;
}

/** i18n keys under commandersIndex.squad.* */
export const MAIN_SQUAD_LABEL_KEYS: Record<MainSquadType, string> = {
  aircraft: "squadAircraft",
  tank: "squadTank",
  missile: "squadMissile",
};

export function mainSquadSortOrder(squad: MainSquadType | null): number {
  if (squad === "aircraft") return 0;
  if (squad === "tank") return 1;
  if (squad === "missile") return 2;
  return 3;
}
