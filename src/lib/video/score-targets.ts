/** Score upload targets — maps user selection to OCR schema and Ashed submit config. */

import {
  MEMBER_ROSTER_VIDEO_SCORE_TARGET,
  ROSTER_VIDEO_OCR_SCHEMA,
} from "@/lib/members/ashed-member-record";
import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import type { VideoOcrAccuracy } from "@/lib/video/ocr-accuracy";

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
  | "hqEventId"
  | "bankId";

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
  /**
   * Expected in-house (Tesseract) OCR accuracy for this event type.
   * Ashed is assumed to handle all targets; this sets expectations for
   * fully-native alliances that rely on our OCR.
   */
  inHouseOcrAccuracy: VideoOcrAccuracy;
};

const DEPOSIT_SLIP_OCR_SCHEMA = {
  type: "object",
  properties: {
    slips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          commanderName: { type: "string" },
          amount: { type: "number" },
          termDays: { type: "number" },
          depositAt: { type: "string" },
          status: { type: "string" },
          allianceTag: { type: "string" },
        },
        required: ["commanderName", "amount", "termDays", "depositAt"],
      },
    },
  },
  required: ["slips"],
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
    inHouseOcrAccuracy: "mid",
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
    inHouseOcrAccuracy: "mid",
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
    inHouseOcrAccuracy: "mid",
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
    inHouseOcrAccuracy: "low",
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
    // bulk + delete-by-date: true Ashed upsert was never wired; per-row POST
    // created duplicates on re-submit and was ~10s for ~100 rows.
    submitMethod: "bulk",
    submitContext: ["recordedDate"],
    inHouseOcrAccuracy: "low",
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
    inHouseOcrAccuracy: "mid",
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
    inHouseOcrAccuracy: "low",
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
    inHouseOcrAccuracy: "low",
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
    inHouseOcrAccuracy: "none",
  },
  {
    id: MEMBER_ROSTER_VIDEO_SCORE_TARGET,
    labelKey: "memberRosterVideo",
    group: "hq-native",
    submitEntity: "",
    ocrSchema: ROSTER_VIDEO_OCR_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: null,
    seriesEntity: null,
    submitMethod: "row-post",
    submitContext: [],
    inHouseOcrAccuracy: "high",
  },
  {
    id: BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET,
    labelKey: "bankDepositSlipHistory",
    group: "hq-native",
    submitEntity: "",
    ocrSchema: DEPOSIT_SLIP_OCR_SCHEMA,
    enabled: true,
    leaderboardModel: "linear-full",
    eventEntity: null,
    seriesEntity: null,
    submitMethod: "row-post",
    submitContext: ["bankId"],
    inHouseOcrAccuracy: "mid",
  },
];

export const ENABLED_SCORE_TARGETS = SCORE_TARGETS.filter((t) => t.enabled);

/** Score targets where zero is a normal score — no review-page zero warning. */
export const ZERO_SCORE_WARNING_DISABLED_SCORE_TARGETS = [
  "vs-performance",
  "zombie-siege",
] as const;

export function isZeroScoreWarningDisabled(scoreTargetId: string): boolean {
  return (ZERO_SCORE_WARNING_DISABLED_SCORE_TARGETS as readonly string[]).includes(
    scoreTargetId,
  );
}

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

export function isMemberRosterVideoTarget(id: string): boolean {
  return id === MEMBER_ROSTER_VIDEO_SCORE_TARGET;
}

export function isBankDepositSlipHistoryTarget(id: string): boolean {
  return id === BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET;
}

/** Targets that always use in-house OCR (Ashed has no schema for them). */
export function isNativeOnlyVideoTarget(id: string): boolean {
  return isBankDepositSlipHistoryTarget(id);
}

export function isHqOnlySubmitTarget(target: ScoreTargetDef): boolean {
  return (
    isMemberRosterVideoTarget(target.id) ||
    isBankDepositSlipHistoryTarget(target.id)
  );
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
  showRosterColumns: boolean;
  showScoreColumn: boolean;
  showDepositSlipColumns: boolean;
  showBankSelector: boolean;
};

export function toScoreTargetClientMeta(
  target: ScoreTargetDef,
): ScoreTargetClientMeta {
  const isDepositSlip = isBankDepositSlipHistoryTarget(target.id);
  const isRoster = isMemberRosterVideoTarget(target.id);
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
    showRosterColumns: isRoster,
    showScoreColumn: !isRoster && !isDepositSlip,
    showDepositSlipColumns: isDepositSlip,
    showBankSelector: target.submitContext.includes("bankId"),
  };
}
