import {
  dayIndexInTrainWeek,
  weekDatesInTrainWeek,
} from "@/lib/trains/train-week-calendar.shared";
import { weekDatesFromMonday } from "@/lib/trains/game-time";
import type { WeekTemplateType } from "@/lib/trains/types";
import { WEEK_TEMPLATES } from "@/lib/trains/types";

/** Segment templates — paintable / composable, not offered as whole-week schedule presets. */
export const WEEK_TEMPLATE_SEGMENTS = [
  "vs_push_weekdays",
  "r4_event_vip",
  "price_is_right_weekdays",
  "top_vs",
  "top_vr",
] as const;

export type WeekTemplateSegmentId = (typeof WEEK_TEMPLATE_SEGMENTS)[number];

export function isWeekTemplateSegment(
  template: WeekTemplateType,
): template is WeekTemplateSegmentId {
  return (WEEK_TEMPLATE_SEGMENTS as readonly string[]).includes(template);
}

/** Whole-week presets shown in the Week template dropdown. */
export const SELECTABLE_WEEK_TEMPLATES = WEEK_TEMPLATES.filter(
  (template) => !isWeekTemplateSegment(template),
) as Exclude<WeekTemplateType, WeekTemplateSegmentId>[];

/** Week templates with `trains.templateDetails.*` hint copy in the selector UI. */
export const WEEK_TEMPLATES_WITH_DETAIL_HINTS: readonly WeekTemplateType[] = [
  "vs_push_week",
  "vs_push_weekdays",
  "r4_event_vip",
  "economy_week",
  "price_is_right",
  "price_is_right_weekdays",
  "takedown_week",
  "r3_recognition",
  "r4_train_week",
  "donations_week",
  "custom",
] as const;

export type CompositeWeekTemplateSegment = {
  template: WeekTemplateType;
  /** Train week index: Tue=0 … Mon=6 (alliance default). */
  dayIndices: readonly number[];
};

export type CompositeWeekTemplateDefinition = {
  segments: readonly CompositeWeekTemplateSegment[];
};

/**
 * Composite week templates expand to per-day segment templates (mechanics + paint).
 * User-defined reusable composites can plug in here later.
 */
export const COMPOSITE_WEEK_TEMPLATES: Partial<
  Record<WeekTemplateType, CompositeWeekTemplateDefinition>
> = {
  vs_push_week: {
    segments: [
      { template: "vs_push_weekdays", dayIndices: [0, 1, 2, 3, 4] },
      { template: "r4_event_vip", dayIndices: [5, 6] },
    ],
  },
  price_is_right: {
    segments: [
      // Tue–Fri
      { template: "price_is_right_weekdays", dayIndices: [0, 1, 2, 3] },
      // Sat
      { template: "takedown_week", dayIndices: [4] },
      // Sun–Mon
      { template: "custom", dayIndices: [5, 6] },
    ],
  },
};

export function isCompositeWeekTemplate(
  template: WeekTemplateType,
): template is keyof typeof COMPOSITE_WEEK_TEMPLATES {
  return template in COMPOSITE_WEEK_TEMPLATES;
}

/**
 * Reverse-map a segment-only template to its composite parent.
 * Returns `null` when `segment` is not a segment of any composite.
 */
export function compositeParentForSegment(
  segment: WeekTemplateType,
): WeekTemplateType | null {
  for (const [composite, def] of Object.entries(COMPOSITE_WEEK_TEMPLATES)) {
    if (def?.segments.some((s) => s.template === segment)) {
      return composite as WeekTemplateType;
    }
  }
  return null;
}

/** Monday-start week index (legacy VS calendar helpers). */
export function dayIndexInWeek(date: string, weekStart: string): number {
  return weekDatesFromMonday(weekStart).indexOf(date);
}

export function dayIndexInTrainWeekForSchedule(
  date: string,
  weekStart: string,
): number {
  return dayIndexInTrainWeek(date, weekStart);
}

export function segmentTemplateForDayIndex(
  composite: WeekTemplateType,
  dayIndex: number,
): WeekTemplateType {
  const definition = COMPOSITE_WEEK_TEMPLATES[composite];
  if (!definition) return composite;
  for (const segment of definition.segments) {
    if (segment.dayIndices.includes(dayIndex)) {
      return segment.template;
    }
  }
  return composite;
}

/** Paint + persisted conductorConfig template for a calendar day. */
export function resolvePaintTemplateForDay(
  templateType: WeekTemplateType,
  date: string,
  weekStart: string,
): WeekTemplateType {
  const dayIndex = dayIndexInTrainWeek(date, weekStart);
  if (dayIndex < 0) return templateType;
  return segmentTemplateForDayIndex(templateType, dayIndex);
}

export type WeekTemplateDayShapeEntry = {
  date: string;
  segment: WeekTemplateType;
};

/**
 * Per-day paint segment for the full train week starting at `weekStart`, in
 * calendar order. Powers the week-shape preview strip in the template picker.
 */
export function weekTemplateDayShape(
  templateType: WeekTemplateType,
  weekStart: string,
): WeekTemplateDayShapeEntry[] {
  return weekDatesInTrainWeek(weekStart).map((date) => ({
    date,
    segment: resolvePaintTemplateForDay(templateType, date, weekStart),
  }));
}

/** Segment templates with a single combined cell label (not conductor + VIP lines). */
export const COMBINED_SEGMENT_DISPLAY_TEMPLATES: ReadonlySet<WeekTemplateType> =
  new Set([
    "r4_event_vip",
    "price_is_right",
    "price_is_right_weekdays",
    "takedown_week",
  ]);

export function usesCombinedSegmentDisplay(
  paintTemplate: WeekTemplateType | null | undefined,
): paintTemplate is WeekTemplateType {
  return (
    paintTemplate != null &&
    COMBINED_SEGMENT_DISPLAY_TEMPLATES.has(paintTemplate)
  );
}
