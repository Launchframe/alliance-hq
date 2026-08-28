import type { VsCalculatorDayNumber } from "@/lib/vs-calculator/vs-calendar.shared";

export type VsPointsByDay = Partial<Record<VsCalculatorDayNumber, number>>;

export type VsCatalogSeedItem = {
  slug: string;
  displayName: string;
  pointsByDay: VsPointsByDay;
  sortOrder: number;
};

/** Seeded from duel-theme screenshots + maintainer corrections (Lv.6 unit, Lv.7 drone chest cap). */
export const VS_CATALOG_SEED_ITEMS: VsCatalogSeedItem[] = [
  {
    slug: "stamina",
    displayName: "Stamina",
    pointsByDay: { 1: 375 },
    sortOrder: 10,
  },
  {
    slug: "radar_intel",
    displayName: "Radar intel",
    pointsByDay: { 1: 30000, 3: 30000 },
    sortOrder: 20,
  },
  {
    slug: "hero_exp_660",
    displayName: "Hero EXP (660)",
    pointsByDay: { 1: 2.5, 4: 2.5 },
    sortOrder: 30,
  },
  {
    slug: "drone_battle_data",
    displayName: "Drone battle data",
    pointsByDay: { 1: 7.5 },
    sortOrder: 40,
  },
  {
    slug: "drone_part",
    displayName: "Drone part",
    pointsByDay: { 1: 6250, 3: 6250 },
    sortOrder: 50,
  },
  {
    slug: "diamond",
    displayName: "Diamond",
    pointsByDay: { 1: 30, 2: 30, 3: 30, 4: 30, 5: 30 },
    sortOrder: 60,
  },
  {
    slug: "food_100k",
    displayName: "Food (100K)",
    pointsByDay: { 1: 50, 2: 50, 5: 50 },
    sortOrder: 70,
  },
  {
    slug: "iron_100k",
    displayName: "Iron (100K)",
    pointsByDay: { 1: 50, 2: 50, 5: 50 },
    sortOrder: 80,
  },
  {
    slug: "coins_60k",
    displayName: "Coins (60K)",
    pointsByDay: { 1: 50 },
    sortOrder: 90,
  },
  {
    slug: "chip_chest_premium_mat",
    displayName: "Premium material chip chest",
    pointsByDay: { 1: 2812.5, 4: 2812.5 },
    sortOrder: 100,
  },
  {
    slug: "ur_shard",
    displayName: "UR shard",
    pointsByDay: { 1: 25000, 4: 25000 },
    sortOrder: 110,
  },
  {
    slug: "ssr_shard",
    displayName: "SSR shard",
    pointsByDay: { 1: 8750, 4: 8750 },
    sortOrder: 120,
  },
  {
    slug: "sr_shard",
    displayName: "SR shard",
    pointsByDay: { 1: 2500, 4: 2500 },
    sortOrder: 130,
  },
  {
    slug: "construction_speedup_1m",
    displayName: "Construction speedup (1m)",
    pointsByDay: { 2: 150 },
    sortOrder: 200,
  },
  {
    slug: "ur_truck",
    displayName: "UR truck",
    pointsByDay: { 2: 300000 },
    sortOrder: 210,
  },
  {
    slug: "ur_secret_file",
    displayName: "UR secret file",
    pointsByDay: { 2: 225000 },
    sortOrder: 220,
  },
  {
    slug: "recruit_ticket",
    displayName: "Recruit ticket",
    pointsByDay: { 2: 4500, 4: 4500 },
    sortOrder: 230,
  },
  {
    slug: "armament_material",
    displayName: "Armament material",
    pointsByDay: { 2: 2.5, 5: 2.5 },
    sortOrder: 240,
  },
  {
    slug: "armament_core",
    displayName: "Armament core",
    pointsByDay: { 2: 6250, 5: 6250 },
    sortOrder: 250,
  },
  {
    slug: "research_speedup_1m",
    displayName: "Research speedup (1m)",
    pointsByDay: { 3: 150 },
    sortOrder: 300,
  },
  {
    slug: "valor_medal",
    displayName: "Valor medal",
    pointsByDay: { 3: 750, 5: 750 },
    sortOrder: 310,
  },
  {
    slug: "drone_chest_l7",
    displayName: "Drone chest (Lv.7)",
    pointsByDay: { 3: 2025000 },
    sortOrder: 320,
  },
  {
    slug: "drone_chest_l6",
    displayName: "Drone chest (Lv.6)",
    pointsByDay: { 3: 275000 },
    sortOrder: 330,
  },
  {
    slug: "drone_chest_l5",
    displayName: "Drone chest (Lv.5)",
    pointsByDay: { 3: 27500 },
    sortOrder: 340,
  },
  {
    slug: "honor_medal",
    displayName: "Honor medal",
    pointsByDay: { 4: 5000 },
    sortOrder: 400,
  },
  {
    slug: "skill_medal",
    displayName: "Skill medal",
    pointsByDay: { 4: 25 },
    sortOrder: 405,
  },
  {
    slug: "exclusive_weapon_mat",
    displayName: "Exclusive weapon shard",
    pointsByDay: { 4: 25000 },
    sortOrder: 410,
  },
  {
    slug: "march_speedup_1m",
    displayName: "March speedup (1m)",
    pointsByDay: { 5: 150 },
    sortOrder: 500,
  },
  {
    slug: "train_unit_lv6",
    displayName: "Train Lv.6 unit",
    pointsByDay: { 5: 210 },
    sortOrder: 510,
  },
];

export function pointsForCatalogDay(
  pointsByDay: VsPointsByDay,
  day: VsCalculatorDayNumber,
): number {
  return pointsByDay[day] ?? 0;
}
