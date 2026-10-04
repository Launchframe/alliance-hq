/**
 * Warzone event-evidence contract — shared between the native/Ashed OCR
 * parser, the upload/review client, and the HQ save path.
 *
 * Poll rows never carry a real score; leaderboard rows carry the actual
 * points as a canonical decimal string plus the cross-alliance observed
 * rank. Everything here is client-safe (no I/O).
 */

import { z } from "zod";

/** Score-target ids for the Warzone evidence upload. */
export const WARZONE_EVIDENCE_AUTO_TARGET = "warzone-evidence";
export const WARZONE_LEADERBOARD_TARGET = "warzone-leaderboard";
export const WARZONE_POLL_TARGET = "warzone-poll";

export const WARZONE_EVIDENCE_TARGETS = [
  WARZONE_EVIDENCE_AUTO_TARGET,
  WARZONE_LEADERBOARD_TARGET,
  WARZONE_POLL_TARGET,
] as const;

export type WarzoneEvidenceTargetId =
  (typeof WARZONE_EVIDENCE_TARGETS)[number];

export function isWarzoneEvidenceTarget(
  id: string | null | undefined,
): id is WarzoneEvidenceTargetId {
  return (
    id != null && (WARZONE_EVIDENCE_TARGETS as readonly string[]).includes(id)
  );
}

/** Upload format override bound to each score target id. */
export type WarzoneUploadFormat = "auto" | "leaderboard" | "poll";

export function warzoneTargetFormat(
  targetId: WarzoneEvidenceTargetId,
): WarzoneUploadFormat {
  if (targetId === WARZONE_LEADERBOARD_TARGET) return "leaderboard";
  if (targetId === WARZONE_POLL_TARGET) return "poll";
  return "auto";
}

/**
 * Typed event binding carried on the upload group/job so alternate passes
 * cannot drift onto a different event or board.
 */
export const eventUploadContextSchema = z.object({
  /** HQ event occurrence id. */
  eventId: z.string().min(1),
  /** HQ event board id (key) inside that occurrence. */
  boardId: z.string().min(1),
});

export type EventUploadContext = z.infer<typeof eventUploadContextSchema>;

/** Crop rectangle within a frame, in relative [0,1] coordinates. */
export type WarzoneCropRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** One leaderboard row parsed from a Warzone RANKING frame. */
export type WarzoneLeaderboardEntry = {
  name: string;
  allianceTag: string | null;
  /** Actual points, canonical decimal string; null when unreadable. */
  actualScore: string | null;
  /** Global rank printed in the game UI — never an alliance Top X index. */
  observedRank: number | null;
  /** Row crop inside the source frame (relative coords). */
  crop: WarzoneCropRegion | null;
  /** True for the green pinned "self" row duplicated at the bottom. */
  pinned?: boolean;
};

/** One poll row — name only; the option is carried per frame. */
export type WarzonePollEntry = {
  name: string;
  crop: WarzoneCropRegion | null;
};

/**
 * Typed per-frame result (plan §6). `poll.option` is null when the option
 * header is unreadable — those rows stay unresolved and must not inherit a
 * previous frame's Yes.
 */
export type WarzoneFrame =
  | {
      kind: "leaderboard";
      entries: WarzoneLeaderboardEntry[];
    }
  | {
      kind: "poll";
      option: 1 | 2 | null;
      entries: WarzonePollEntry[];
    }
  | {
      kind: "unknown";
      reason: string;
    };

/** Detected layout kinds the auto detector chooses among. */
export type WarzoneFrameKind = WarzoneFrame["kind"];

/**
 * Result for one frame with source metadata carried through matching and
 * review (frame index + optional video timestamp).
 */
export type WarzoneFrameResult = {
  frameIndex: number;
  videoTimestampSeconds: number | null;
  frame: WarzoneFrame;
  /**
   * Foreground evidence region (relative coords) safe to show reviewers.
   * Null = no safe crop — reviewers must not be served the original bytes.
   */
  safeCrop: WarzoneCropRegion | null;
  /** Detected layout contradicted the uploader's manual format choice. */
  formatMismatch: boolean;
};

/** Evidence kinds the review UI hands to the save contract. */
export const WARZONE_REVIEW_EVIDENCE_KINDS = [
  "leaderboard",
  "poll_yes",
  "poll_no",
] as const;

export type WarzoneReviewEvidenceKind =
  (typeof WARZONE_REVIEW_EVIDENCE_KINDS)[number];

/**
 * Review-row contract carried on parsed rows (`parsed_rows.event_evidence`)
 * and in the save payload. `crop` lets the review UI show the cropped source
 * region; `pollOption` is the detected option (1|2) or null when unreadable.
 */
export const warzoneReviewRowSchema = z.object({
  kind: z.enum(WARZONE_REVIEW_EVIDENCE_KINDS),
  /** Detected poll option for poll rows (before review confirmation). */
  pollOption: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  crop: z
    .object({
      left: z.number(),
      top: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable()
    .optional(),
  /** Source frame metadata. */
  frameIndex: z.number().int().nullable().optional(),
  videoTimestampSeconds: z.number().nullable().optional(),
  /** True when the detected layout contradicted the manual format choice. */
  formatMismatch: z.boolean().optional(),
});

export type WarzoneReviewRow = z.infer<typeof warzoneReviewRowSchema>;

/** Submission payload for the media-backed event save. */
export const eventEvidenceSubmitSchema = z.object({
  requestId: z.string().min(8).max(80),
  /** Poll polarity must be confirmed before poll rows can save. */
  pollOptionsConfirmed: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        /** Parsed row id being saved (null for manually added rows). */
        rowId: z.string().nullable(),
        memberId: z.string().nullable(),
        memberName: z.string().nullable().optional(),
        kind: z.enum(WARZONE_REVIEW_EVIDENCE_KINDS),
        /** Canonical decimal string; forbidden on poll rows. */
        realScore: z.string().nullable().optional(),
        observedRank: z.number().int().nullable().optional(),
        pollOption: z
          .union([z.literal(1), z.literal(2)])
          .nullable()
          .optional(),
        /** True = exclude this row from the save entirely. */
        excluded: z.boolean().optional(),
        correctionReason: z.string().max(280).nullable().optional(),
      }),
    )
    .max(2000),
});

export type EventEvidenceSubmitInput = z.infer<typeof eventEvidenceSubmitSchema>;

/** Option → evidence kind mapping applied only after officer confirmation. */
export function pollOptionToEvidenceKind(
  option: 1 | 2,
): Extract<WarzoneReviewEvidenceKind, "poll_yes" | "poll_no"> {
  return option === 1 ? "poll_yes" : "poll_no";
}

/** Keys like `Power:123456` / `LV.35` / R badges must never become scores. */
export const WARZONE_IGNORED_VALUE_PREFIXES = /\b(?:power|lv\.?|r[1-5])\b/iu;
