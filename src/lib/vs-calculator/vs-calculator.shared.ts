import type {
  VsCalculatorDayNumber,
  VsMatchDayNumber,
} from "@/lib/vs-calculator/vs-calendar.shared";
import type { VsCatalogItemDef, VsInventoryQuantities } from "@/lib/vs-calculator/capacity.shared";

export function isCalculatorDay(
  day: VsMatchDayNumber | null,
): day is VsCalculatorDayNumber {
  return day != null && day >= 1 && day <= 5;
}

export type VsCalculatorSaveHints = {
  radar: string | null;
  shiny: string[];
};

export type VsCalculatorDaySummary = {
  day: VsCalculatorDayNumber;
  themeKey: string;
  totalPoints: number;
  saveHints: VsCalculatorSaveHints;
};

export type VsCalculatorAnnouncementPreview = {
  targetDate: string;
  message: string;
};

export type VsCalculatorPayload = {
  commanderId: string;
  pinnedDate: string;
  pinnedDay: VsMatchDayNumber | null;
  quantities: VsInventoryQuantities;
  catalog: VsCatalogItemDef[];
  dayTotal: number;
  weekly: VsCalculatorDaySummary[];
  shinyWeekdays: [number, number] | null;
  announcementPreview: VsCalculatorAnnouncementPreview;
};
