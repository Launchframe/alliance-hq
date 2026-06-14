/** Score upload targets — maps user selection to OCR schema and Ashed submit config. */

export type ScoreTargetGroup = "events" | "recurring" | "hq-native";

export type ScoreTargetDef = {
  id: string;
  labelKey: string;
  group: ScoreTargetGroup;
  /** Base44 entity for bulk submit; null = HQ-only (Phase 3) */
  submitEntity: string | null;
  ocrSchema: Record<string, unknown>;
  /** Phase 1: only desert-storm is fully wired */
  enabled: boolean;
};

const ENTRIES_NUMBER_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number" },
        },
        required: ["name", "score"],
      },
    },
  },
  required: ["entries"],
};

export const SCORE_TARGETS: ScoreTargetDef[] = [
  {
    id: "desert-storm",
    labelKey: "desertStorm",
    group: "events",
    submitEntity: "DesertStormScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
  },
  {
    id: "canyon-storm",
    labelKey: "canyonStorm",
    group: "events",
    submitEntity: "CanyonStormScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: false,
  },
  {
    id: "alliance-exercise",
    labelKey: "allianceExercise",
    group: "events",
    submitEntity: "AllianceExerciseScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: false,
  },
  {
    id: "zombie-siege",
    labelKey: "zombieSiege",
    group: "events",
    submitEntity: "ZombieSiegeScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: false,
  },
  {
    id: "vs-performance",
    labelKey: "vsPerformance",
    group: "recurring",
    submitEntity: "VSScore",
    ocrSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              score: { type: "string" },
              rank: { type: "number" },
            },
            required: ["name", "score"],
          },
        },
      },
      required: ["entries"],
    },
    enabled: false,
  },
  {
    id: "donations",
    labelKey: "donations",
    group: "recurring",
    submitEntity: "Donation",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: false,
  },
];

export const ENABLED_SCORE_TARGETS = SCORE_TARGETS.filter((t) => t.enabled);

export function getScoreTarget(id: string): ScoreTargetDef | undefined {
  return SCORE_TARGETS.find((t) => t.id === id);
}

export function getScoreTargetOrThrow(id: string): ScoreTargetDef {
  const target = getScoreTarget(id);
  if (!target) {
    throw new Error(`Unknown score target: ${id}`);
  }
  return target;
}

/** Extra fields required on submit for event score types */
export type DesertStormSubmitContext = {
  eventId: string;
  team: "A" | "B";
  recordedDate: string;
};
