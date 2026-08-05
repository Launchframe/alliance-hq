import type { VsCalculatorDayNumber } from "@/lib/vs-calculator/vs-calendar.shared";
import type { VsPointsByDay } from "@/lib/vs-calculator/catalog-seed.shared";
import { pointsForCatalogDay } from "@/lib/vs-calculator/catalog-seed.shared";

export type VsInventoryQuantities = Record<string, number>;

export type VsCatalogItemDef = {
  slug: string;
  displayName: string;
  pointsByDay: VsPointsByDay;
  sortOrder: number;
};

export function lineScoreForItem(
  qty: number,
  pointsPerUnit: number,
): number {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(pointsPerUnit)) {
    return 0;
  }
  return qty * pointsPerUnit;
}

export function sumCapacityForDay(
  day: VsCalculatorDayNumber,
  quantities: VsInventoryQuantities,
  defs: VsCatalogItemDef[],
): number {
  let total = 0;
  for (const def of defs) {
    const points = pointsForCatalogDay(def.pointsByDay, day);
    if (points <= 0) continue;
    const qty = quantities[def.slug] ?? 0;
    total += lineScoreForItem(qty, points);
  }
  return total;
}

export function catalogDefsForDay(
  day: VsCalculatorDayNumber,
  defs: VsCatalogItemDef[],
): VsCatalogItemDef[] {
  return defs
    .filter((def) => pointsForCatalogDay(def.pointsByDay, day) > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
}

export function topEarnPointLinesForDay(
  day: VsCalculatorDayNumber,
  defs: VsCatalogItemDef[],
  limit = 5,
): string[] {
  return catalogDefsForDay(day, defs)
    .map((def) => ({
      name: def.displayName,
      points: pointsForCatalogDay(def.pointsByDay, day),
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) => `${row.name} — ${formatVsPoints(row.points)} pts each`);
}

export function formatVsPoints(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString("en-US");
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
