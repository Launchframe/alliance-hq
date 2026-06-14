/** Score upload targets — maps user selection to OCR schema and Ashed submit config. */

export type ScoreTargetGroup = "events" | "recurring" | "hq-native";

export type LeaderboardModel =
  | "linear-full"
  | "multi-board"
  | "podium-commendation";

export type SubmitMethod = "bulk" | "row-post" | "upsert";

export type SubmitContextField =
  | "eventId"
  | "team"
  | "recordedDate"
  | "boardKey"
  | "commendationId"
  | "hqEventId";

export type SeasonalBoardType = "kills" | "resources" | "points";

export type ScoreTargetDef = {
  id: string;
  labelKey: string;
  group: ScoreTargetGroup;
  submitEntity: string;
  ocrSchema: Record<string, unknown>;
  enabled: boolean;
  leaderboardModel: LeaderboardModel;
  /** Base44 entity for event picker (null = use hq_events or no picker) */
  eventEntity: string | null;
  seriesEntity: "EventSeries" | null;
  submitMethod: SubmitMethod;
  submitContext: SubmitContextField[];
  boardTypes?: SeasonalBoardType[];
  /** Default EventSeries name when provisioning custom events */
  defaultSeriesName?: string;
  /** Default score_type on EventSeries / SeasonalEvent */
  defaultScoreType?: string;
  /** Max active rows at submit (podium) */
  maxSubmitRows?: number;
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

const ENTRIES_RANK_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          rank: { type: "number" },
        },
        required: ["name", "score", "rank"],
      },
    },
  },
  required: ["entries"],
};

const STORM_SUBMIT_CONTEXT: SubmitContextField[] = [
  "eventId",
  "team",
  "recordedDate",
];

export const SCORE_TARGETS: ScoreTargetDef[] = [
  {
    id: "desert-storm",
    labelKey: "desertStorm",
    group: "events",
    submitEntity: "DesertStormScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: "DesertStormEvent",
    seriesEntity: null,
    submitMethod: "bulk",
    submitContext: STORM_SUBMIT_CONTEXT,
  },
  {
    id: "canyon-storm",
    labelKey: "canyonStorm",
    group: "events",
    submitEntity: "CanyonStormScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: "CanyonStormEvent",
    seriesEntity: null,
    submitMethod: "bulk",
    submitContext: STORM_SUBMIT_CONTEXT,
  },
  {
    id: "alliance-exercise",
    labelKey: "allianceExercise",
    group: "recurring",
    submitEntity: "AllianceExerciseScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: "AllianceExercise",
    seriesEntity: null,
    submitMethod: "bulk",
    submitContext: ["eventId", "recordedDate"],
  },
  {
    id: "zombie-siege",
    labelKey: "zombieSiege",
    group: "events",
    submitEntity: "ZombieSiegeScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: "ZombieSiegeEvent",
    seriesEntity: null,
    submitMethod: "bulk",
    submitContext: ["eventId", "recordedDate"],
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
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: null,
    seriesEntity: null,
    submitMethod: "upsert",
    submitContext: ["recordedDate"],
  },
  {
    id: "donations",
    labelKey: "donations",
    group: "recurring",
    submitEntity: "Donation",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: null,
    seriesEntity: null,
    submitMethod: "bulk",
    submitContext: ["recordedDate"],
  },
  {
    id: "frontline-breakthrough",
    labelKey: "frontlineBreakthrough",
    group: "hq-native",
    submitEntity: "SeasonalScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: "SeasonalEvent",
    seriesEntity: "EventSeries",
    submitMethod: "row-post",
    submitContext: ["hqEventId", "recordedDate"],
    defaultSeriesName: "Frontline Breakthrough",
    defaultScoreType: "points",
  },
  {
    id: "seasonal",
    labelKey: "seasonal",
    group: "hq-native",
    submitEntity: "SeasonalScore",
    ocrSchema: ENTRIES_NUMBER_SCHEMA,
    enabled: true,
    leaderboardModel: "multi-board",
    eventEntity: "SeasonalEvent",
    seriesEntity: "EventSeries",
    submitMethod: "row-post",
    submitContext: ["hqEventId", "boardKey", "recordedDate"],
    boardTypes: ["kills", "resources", "points"],
    defaultSeriesName: "Seasonal",
    defaultScoreType: "points",
  },
  {
    id: "alliance-star",
    labelKey: "allianceStar",
    group: "hq-native",
    submitEntity: "SeasonalScore",
    ocrSchema: ENTRIES_RANK_SCHEMA,
    enabled: false,
    leaderboardModel: "podium-commendation",
    eventEntity: "SeasonalEvent",
    seriesEntity: "EventSeries",
    submitMethod: "row-post",
    submitContext: ["hqEventId", "commendationId", "recordedDate"],
    defaultSeriesName: "Alliance Star",
    defaultScoreType: "points",
    maxSubmitRows: 3,
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

export function usesHqEventStore(target: ScoreTargetDef): boolean {
  return target.seriesEntity === "EventSeries";
}

export function requiresBoardKey(target: ScoreTargetDef): boolean {
  return target.leaderboardModel === "multi-board";
}

export function requiresCommendation(target: ScoreTargetDef): boolean {
  return target.leaderboardModel === "podium-commendation";
}

export type ScoreTargetClientMeta = {
  id: string;
  labelKey: string;
  group: ScoreTargetGroup;
  leaderboardModel: LeaderboardModel;
  eventEntity: string | null;
  submitContext: SubmitContextField[];
  boardTypes?: SeasonalBoardType[];
  maxSubmitRows?: number;
  usesHqEvents: boolean;
  showRankColumn: boolean;
  showTeamSelector: boolean;
};

export function toScoreTargetClientMeta(
  target: ScoreTargetDef,
): ScoreTargetClientMeta {
  return {
    id: target.id,
    labelKey: target.labelKey,
    group: target.group,
    leaderboardModel: target.leaderboardModel,
    eventEntity: target.eventEntity,
    submitContext: target.submitContext,
    boardTypes: target.boardTypes,
    maxSubmitRows: target.maxSubmitRows,
    usesHqEvents: usesHqEventStore(target),
    showRankColumn:
      target.id === "vs-performance" ||
      target.leaderboardModel === "podium-commendation",
    showTeamSelector: target.submitContext.includes("team"),
  };
}
