import type {
  HeroDayCandidate,
  HeroDayPushProfilePayload,
  HeroDaySpendMode,
  HeroSkillTier,
} from "@/lib/vs-calculator/planner/planner-types.shared";
import { maxSkillLevelForTier } from "@/lib/vs-calculator/planner/skill-medal-costs.shared";

export const MAX_HERO_DAY_CANDIDATES = 8;

const TIERS: HeroSkillTier[] = ["ur", "ssr", "sr"];
const SPEND_MODES: HeroDaySpendMode[] = ["free_to_play", "spending"];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function sanitizeCandidate(raw: unknown, index: number): HeroDayCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const tier = row.tier;
  if (typeof tier !== "string" || !TIERS.includes(tier as HeroSkillTier)) {
    return null;
  }
  const skillTier = tier as HeroSkillTier;
  const maxSkill = maxSkillLevelForTier(skillTier);
  const skillsRaw = Array.isArray(row.skillLevels) ? row.skillLevels : [1, 1, 1];
  const skillLevels = [
    clampInt(skillsRaw[0], 1, maxSkill, 1),
    clampInt(skillsRaw[1], 1, maxSkill, 1),
    clampInt(skillsRaw[2], 1, maxSkill, 1),
  ] as [number, number, number];

  const label =
    typeof row.label === "string" && row.label.trim().length > 0
      ? row.label.trim().slice(0, 48)
      : `Hero ${index + 1}`;

  return {
    id:
      typeof row.id === "string" && row.id.trim().length > 0
        ? row.id.trim()
        : `hero-${index + 1}`,
    label,
    tier: skillTier,
    heroLevel: clampInt(row.heroLevel, 1, 200, 1),
    skillLevels,
    exclusiveWeaponLevel:
      skillTier === "ur"
        ? clampInt(row.exclusiveWeaponLevel, 0, 30, 0)
        : undefined,
    includeWeaponUnlock:
      skillTier === "ur" ? row.includeWeaponUnlock !== false : undefined,
    allSkillsSameLevel: row.allSkillsSameLevel === true,
  };
}

export function sanitizeHeroDayPushProfile(
  raw: unknown,
): HeroDayPushProfilePayload {
  const row =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const heroesRaw = Array.isArray(row.heroes) ? row.heroes : [];
  const heroes: HeroDayCandidate[] = [];
  for (let i = 0; i < Math.min(heroesRaw.length, MAX_HERO_DAY_CANDIDATES); i++) {
    const candidate = sanitizeCandidate(heroesRaw[i], i);
    if (candidate) heroes.push(candidate);
  }

  const spendMode =
    typeof row.plannerSpendMode === "string" &&
    SPEND_MODES.includes(row.plannerSpendMode as HeroDaySpendMode)
      ? (row.plannerSpendMode as HeroDaySpendMode)
      : "free_to_play";

  const heroShardBatchSizes: Partial<Record<HeroSkillTier, number>> = {};
  const batchRaw =
    row.heroShardBatchSizes && typeof row.heroShardBatchSizes === "object"
      ? (row.heroShardBatchSizes as Record<string, unknown>)
      : {};
  for (const tier of TIERS) {
    const size = batchRaw[tier];
    if (typeof size === "number" && size >= 1 && size <= 100) {
      heroShardBatchSizes[tier] = Math.trunc(size);
    }
  }

  return {
    heroes,
    plannerSpendMode: spendMode,
    heroShardBatchSizes:
      Object.keys(heroShardBatchSizes).length > 0
        ? heroShardBatchSizes
        : undefined,
  };
}

export function emptyHeroDayPushProfile(): HeroDayPushProfilePayload {
  return { heroes: [], plannerSpendMode: "free_to_play" };
}
