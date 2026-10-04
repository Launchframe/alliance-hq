import type { VsCalculatorDayNumber } from "@/lib/vs-calculator/vs-calendar.shared";

export type VsPointsByDay = Partial<Record<VsCalculatorDayNumber, number>>;

export function pointsForCatalogDay(
  pointsByDay: VsPointsByDay,
  day: VsCalculatorDayNumber,
): number {
  return pointsByDay[day] ?? 0;
}
