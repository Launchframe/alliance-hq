/**
 * Evidence-aware dedup across Warzone frames (plan §6). Unlike the generic
 * seasonal merge, evidence kind is part of identity: a Yes row never merges
 * with a No row, and identical leaderboard tuples collapse while differing
 * tuples for the same member surface a conflict the reviewer must resolve.
 */

import { sanitizedNameKey } from "@/lib/video/normalize-rows";
import type {
  WarzoneFrameResult,
  WarzoneReviewEvidenceKind,
} from "@/lib/video/warzone-evidence.shared";

/** One flat review row produced from parsed frames (pre-match). */
export type WarzoneParsedRow = {
  ocrName: string;
  kind: WarzoneReviewEvidenceKind;
  /** Poll rows: detected option at frame level; null = unreadable header. */
  pollOption: 1 | 2 | null;
  /** Leaderboard rows: canonical decimal string or null. */
  realScore: string | null;
  observedRank: number | null;
  frameIndex: number;
  videoTimestampSeconds: number | null;
  crop: { left: number; top: number; width: number; height: number } | null;
  formatMismatch: boolean;
  /** Poll row whose frame option header was unreadable — review blocker. */
  unresolvedOption: boolean;
};

export type WarzoneDedupResult = {
  rows: WarzoneParsedRow[];
  /** Names with contradictory leaderboard tuples — review-required. */
  conflicts: string[];
  /** Names seen under both poll options — review-required. */
  pollConflicts: string[];
};

function leaderboardTupleKey(row: WarzoneParsedRow): string {
  return `${row.realScore ?? "?"}|${row.observedRank ?? "?"}`;
}

/**
 * Collapse parsed frames into review rows.
 *
 * - Leaderboard dupes collapse only on the identical (score, rank) tuple;
 *   different tuples for one name ⇒ both kept and flagged as conflict.
 * - Poll rows dedup per (name, option); a name under option 1 AND option 2
 *   is never merged — both rows stay and are flagged.
 * - Unreadable-option poll rows are kept (unresolved), never merged into a
 *   Yes/No bucket.
 * - Unknown-layout frames produce no rows.
 */
export function dedupeWarzoneEvidence(
  frames: readonly WarzoneFrameResult[],
  options?: { allianceTag?: string | null },
): WarzoneDedupResult {
  const leaderboard = new Map<string, WarzoneParsedRow[]>();
  const poll = new Map<string, WarzoneParsedRow[]>();
  const order: WarzoneParsedRow[] = [];

  for (const frameResult of frames) {
    const frame = frameResult.frame;
    const mismatch = frameResult.formatMismatch;
    if (frame.kind === "leaderboard") {
      for (const entry of frame.entries) {
        const key = sanitizedNameKey(entry.name, options?.allianceTag);
        const row: WarzoneParsedRow = {
          ocrName: entry.name,
          kind: "leaderboard",
          pollOption: null,
          realScore: entry.actualScore,
          observedRank: entry.observedRank,
          frameIndex: frameResult.frameIndex,
          videoTimestampSeconds: frameResult.videoTimestampSeconds,
          crop: entry.crop,
          formatMismatch: mismatch,
          unresolvedOption: false,
        };
        const list = leaderboard.get(key) ?? [];
        // Identical tuples collapse; differing tuples both stay.
        if (!list.some((existing) => leaderboardTupleKey(existing) === leaderboardTupleKey(row))) {
          list.push(row);
          leaderboard.set(key, list);
          order.push(row);
        }
      }
    } else if (frame.kind === "poll") {
      for (const entry of frame.entries) {
        const key = sanitizedNameKey(entry.name, options?.allianceTag);
        const row: WarzoneParsedRow = {
          ocrName: entry.name,
          kind:
            frame.option === 1
              ? "poll_yes"
              : frame.option === 2
                ? "poll_no"
                : "poll_yes",
          pollOption: frame.option,
          realScore: null,
          observedRank: null,
          frameIndex: frameResult.frameIndex,
          videoTimestampSeconds: frameResult.videoTimestampSeconds,
          crop: entry.crop,
          formatMismatch: mismatch,
          unresolvedOption: frame.option == null,
        };
        const list = poll.get(key) ?? [];
        if (
          !list.some(
            (existing) => existing.pollOption === row.pollOption,
          )
        ) {
          list.push(row);
          poll.set(key, list);
          order.push(row);
        }
      }
    }
  }

  const conflicts: string[] = [];
  for (const [key, list] of leaderboard) {
    if (new Set(list.map(leaderboardTupleKey)).size > 1) {
      conflicts.push(key);
    }
  }
  const pollConflicts: string[] = [];
  for (const [key, list] of poll) {
    const options = new Set(
      list.map((row) => row.pollOption).filter((o): o is 1 | 2 => o != null),
    );
    if (options.size > 1) {
      pollConflicts.push(key);
    }
  }

  return { rows: order, conflicts, pollConflicts };
}
