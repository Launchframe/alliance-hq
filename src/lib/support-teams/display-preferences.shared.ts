import { z } from "zod";

export const displayPreferencesSchema = z.object({ professionLevel: z.boolean(), baseLevel: z.boolean(), thp: z.boolean(), tenureDays: z.boolean() }).strict();
export type SupportDisplayPreferences = z.infer<typeof displayPreferencesSchema>;
export const defaultDisplayPreferences: SupportDisplayPreferences = { professionLevel: false, baseLevel: false, thp: true, tenureDays: false };
export type MetricFilter = { min?: number; max?: number; unknown?: "include" | "exclude" | "only" };
export type UnsortedFilters = { countries?: string[] } & Partial<Record<"professionLevel" | "baseLevel" | "thp" | "tenureDays", MetricFilter>>;
const countries = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
export function normalizeCountry(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && countries.has(code) ? code : null;
}
export function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function continuousTenureDays(currentStints: string[], now: number): number | null {
  if (currentStints.length !== 1) return null;
  const joined = Date.parse(currentStints[0]);
  return Number.isFinite(joined) && joined <= now ? Math.floor((now - joined) / 86_400_000) : null;
}
export function matchesUnsortedFilters(member: { country: string | null; professionLevel: number | null; baseLevel: number | null; thp: number | null; tenureDays: number | null }, filters: UnsortedFilters) {
  if (filters.countries?.length && !filters.countries.includes(member.country ?? "unknown")) return false;
  return (["professionLevel", "baseLevel", "thp", "tenureDays"] as const).every((key) => {
    const filter = filters[key];
    if (!filter) return true;
    const value = member[key];
    if (value === null) return filter.unknown !== "exclude";
    return filter.unknown !== "only" && (filter.min === undefined || value >= filter.min) && (filter.max === undefined || value <= filter.max);
  });
}
