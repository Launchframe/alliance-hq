/**
 * Evidence-aware dedup across Warzone frames (plan §6). Unlike the generic
 * seasonal merge, evidence kind is part of identity: a Yes row never merges
 * with a No row, and identical leaderboard tuples collapse while differing
 * tuples for the same member surface a conflict the reviewer must resolve.
 *
 * Name matching is accent/case/space-insensitive and tolerant of OCR badge
 * noise: a short glyph-prefix difference or a one-character edit on an
 * identical score still counts as the same member, while a name that only
 * differs by the tail (two different members sharing a surname) does not
 * merge.
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
  /** Frame-level consistency flag (e.g. `score_not_monotonic`). */
  reviewReason: string | null;
  /**
   * True when the row must not be silently accepted — set for conflicting
   * tuples and consistency-flagged rows alike.
   */
  needsReview: boolean;
};

export type WarzoneDedupResult = {
  rows: WarzoneParsedRow[];
  /** Names with contradictory leaderboard tuples — review-required. */
  conflicts: string[];
  /** Names seen under both poll options — review-required. */
  pollConflicts: string[];
  /**
   * Sanitized keys of rows flagged by consistency checks — review-required
   * the same way conflicts are.
   */
  reviewFlags: string[];
};

/**
 * Accent/case/space-insensitive member key — tighter than
 * `sanitizedNameKey` (which keeps decorations for display) so OCR noise
 * like `Sargentão`/`Sargentao` and badge leftovers still collapse.
 */
export function fuzzyWarzoneNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (cur[j]! < rowMin) rowMin = cur[j]!;
    }
    if (rowMin > max) return false;
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length]! <= max;
}

/**
 * Badge/icon OCR noise prepends 1–3 junk characters (`n3 Vilpal`,
 * `o/ Parker Stanley`). A suffix match with ≤3 chars of extra prefix counts
 * as the same member; a longer difference (a genuinely longer name) does
 * not — that is how two members sharing a surname stay distinct.
 */
export function isGlyphPrefixVariant(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return (
    longer.endsWith(shorter) &&
    longer.length - shorter.length <= 3 &&
    shorter.length >= 4
  );
}

function leaderboardTupleKey(row: WarzoneParsedRow): string {
  return `${row.realScore ?? "?"}|${row.observedRank ?? "?"}`;
}

/**
 * Collapse parsed frames into review rows.
 *
 * - Leaderboard dupes collapse on the same normalized member + score;
 *   differing ranks for one (member, score) merge into a single row with
 *   `observedRank: null` — ranks are exact or null, never a confident
 *   wrong value. Differing scores for one member ⇒ both kept + conflict.
 * - Poll rows dedup per (member, option); a name under option 1 AND
 *   option 2 is never merged — both rows stay and are flagged.
 * - Unreadable-option poll rows are kept (unresolved), never merged into a
 *   Yes/No bucket.
 * - Unknown-layout frames produce no rows.
 */
export function dedupeWarzoneEvidence(
  frames: readonly WarzoneFrameResult[],
  options?: { allianceTag?: string | null },
): WarzoneDedupResult {
  type Cluster = {
    keys: Set<string>;
    /** Display name candidate — longest letter-bearing raw name wins. */
    displayName: string;
    rows: WarzoneParsedRow[];
    /** Distinct frames any sighting came from — corroboration signal. */
    frameSpan: Set<number>;
  };
  const leaderboardClusters: Cluster[] = [];
  const pollClusters: Cluster[] = [];
  const order: WarzoneParsedRow[] = [];

  /**
   * Prefer the cleaner variant: a plausible ≥3-char first token beats a
   * glyph-prefix one, then fewer noise tokens, then more name characters.
   */
  const betterName = (a: string, b: string): string => {
    const quality = (s: string): number => {
      const tokens = s.trim().split(/\s+/).filter(Boolean);
      const first = tokens[0] ?? "";
      return (
        (/^[\p{L}\p{N}]{3,}$/u.test(first) ? 1000 : 0) -
        tokens.length * 10 +
        s.replace(/[^\p{L}\p{N}]/gu, "").length
      );
    };
    return quality(b) > quality(a) ? b : a;
  };

  /** ≥4-char contiguous overlap — fragment reads like `Bogs ach`/`2Bogs`. */
  const sharesSubstring = (a: string, b: string): boolean => {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (shorter.length >= 4 && longer.includes(shorter)) return true;
    for (let len = Math.min(shorter.length, 6); len >= 4; len--) {
      for (let i = 0; i + len <= shorter.length; i++) {
        if (longer.includes(shorter.slice(i, i + len))) return true;
      }
    }
    return false;
  };

  /**
   * Same member when keys match or differ by badge noise; on identical
   * score evidence (leaderboard scores are unique per row) a fragment or
   * ≤2-edit misread also merges.
   */
  const sameMemberLoose = (
    cluster: Cluster,
    key: string,
    score: string | null,
  ): boolean => {
    if (cluster.keys.has(key)) return true;
    const scoreShared =
      score != null &&
      cluster.rows.some((row) => row.realScore === score);
    for (const existing of cluster.keys) {
      if (isGlyphPrefixVariant(key, existing)) return true;
      if (editDistanceAtMost(key, existing, 1)) {
        if (scoreShared || key.length >= 6) return true;
      }
      if (key.length >= 8 && editDistanceAtMost(key, existing, 2)) {
        return true;
      }
      if (scoreShared) {
        if (sharesSubstring(key, existing)) return true;
        // Longer prefix/suffix bleed (`Bogs pe` ↔ `BLAKE2Bogs`) on the
        // same score is still one member.
        const [shorter, longer] =
          key.length <= existing.length ? [key, existing] : [existing, key];
        if (
          shorter.length >= 4 &&
          (longer.endsWith(shorter) || longer.startsWith(shorter))
        ) {
          return true;
        }
      }
    }
    return false;
  };

  /** A row with no usable name still belongs to its score's cluster. */
  const scoreCluster = (
    clusters: readonly Cluster[],
    score: string | null,
  ): Cluster | undefined =>
    score == null
      ? undefined
      : clusters.find((c) => c.rows.some((row) => row.realScore === score));

  for (const frameResult of frames) {
    const frame = frameResult.frame;
    const mismatch = frameResult.formatMismatch;
    if (frame.kind === "leaderboard") {
      for (const entry of frame.entries) {
        // A name-only sighting (no score, rank, or tag) carries no
        // syncable evidence — it is card-splitting noise.
        if (
          entry.actualScore == null &&
          entry.observedRank == null &&
          !entry.allianceTag
        ) {
          continue;
        }
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
          reviewReason: entry.reviewReason ?? null,
          needsReview: entry.reviewReason != null,
        };
        const unknownName = entry.name === "?" || !entry.name.trim();
        // "?" rows key on their score so same-score sightings merge but
        // distinct scores never collapse into one faceless cluster.
        const key = unknownName
          ? `?|${row.realScore ?? `f${frameResult.frameIndex}`}`
          : fuzzyWarzoneNameKey(entry.name) ||
            sanitizedNameKey(entry.name, options?.allianceTag);
        const cluster =
          leaderboardClusters.find((c) =>
            unknownName
              ? c.keys.has(key)
              : sameMemberLoose(c, key, row.realScore),
          ) ??
          (unknownName
            ? scoreCluster(leaderboardClusters, row.realScore)
            : undefined);
        if (cluster) {
          cluster.keys.add(key);
          cluster.displayName = betterName(cluster.displayName, row.ocrName);
          // Identical (score, rank) tuples collapse outright; rank-only
          // differences merge below with the rank dropped to null.
          if (
            !cluster.rows.some(
              (existing) => leaderboardTupleKey(existing) === leaderboardTupleKey(row),
            )
          ) {
            cluster.rows.push(row);
            order.push(row);
          } else if (row.reviewReason) {
            // Preserve the flag on the surviving tuple.
            const kept = cluster.rows.find(
              (existing) => leaderboardTupleKey(existing) === leaderboardTupleKey(row),
            );
            if (kept) kept.reviewReason = kept.reviewReason ?? row.reviewReason;
          }
          cluster.frameSpan.add(frameResult.frameIndex);
        } else {
          leaderboardClusters.push({
            keys: new Set([key]),
            displayName: row.ocrName,
            rows: [row],
            frameSpan: new Set([frameResult.frameIndex]),
          });
          order.push(row);
        }
      }
    } else if (frame.kind === "poll") {
      for (const entry of frame.entries) {
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
          reviewReason: null,
          needsReview: false,
        };
        const key = fuzzyWarzoneNameKey(entry.name) ||
          sanitizedNameKey(entry.name, options?.allianceTag);
        const cluster = pollClusters.find(
          (c) =>
            c.keys.has(key) ||
            [...c.keys].some(
              (k) =>
                isGlyphPrefixVariant(k, key) ||
                (key.length >= 6 && editDistanceAtMost(k, key, 1)),
            ),
        );
        const target = cluster ?? {
          keys: new Set<string>(),
          displayName: row.ocrName,
          rows: [] as WarzoneParsedRow[],
          frameSpan: new Set<number>(),
        };
        if (!cluster) pollClusters.push(target);
        target.keys.add(key);
        target.frameSpan.add(frameResult.frameIndex);
        target.displayName = betterName(target.displayName, row.ocrName);
        if (
          !target.rows.some(
            (existing) => existing.pollOption === row.pollOption,
          )
        ) {
          target.rows.push(row);
          order.push(row);
        }
      }
    }
  }

  // A name-obliterated `?` cluster whose score matches a named cluster's
  // row is the same member — absorb it so the score isn't duplicated.
  for (const cluster of [...leaderboardClusters]) {
    if (![...cluster.keys].every((k) => k.startsWith("?|"))) continue;
    const score = cluster.rows.find((r) => r.realScore != null)?.realScore;
    if (score == null) continue;
    const named = leaderboardClusters.find(
      (other) =>
        other !== cluster &&
        ![...other.keys].every((k) => k.startsWith("?|")) &&
        other.rows.some((r) => r.realScore === score),
    );
    if (!named) continue;
    named.rows.push(...cluster.rows);
    for (const f of cluster.frameSpan) named.frameSpan.add(f);
    leaderboardClusters.splice(leaderboardClusters.indexOf(cluster), 1);
  }

  // Leaderboard clusters: rank-only disagreements merge to one row with
  // rank null; score disagreements stay separate rows flagged conflict.
  const conflicts: string[] = [];
  const reviewFlags = new Set<string>();
  const finalRows: WarzoneParsedRow[] = [];
  const emitted = new Set<WarzoneParsedRow>();
  for (const cluster of leaderboardClusters) {
    const byScore = new Map<string, WarzoneParsedRow[]>();
    const unscored: WarzoneParsedRow[] = [];
    for (const row of cluster.rows) {
      if (row.realScore == null) {
        unscored.push(row);
        continue;
      }
      const list = byScore.get(row.realScore) ?? [];
      list.push(row);
      byScore.set(row.realScore, list);
    }
    if (byScore.size > 1) {
      conflicts.push(cluster.displayName);
      for (const list of byScore.values()) {
        list[0]!.needsReview = true;
      }
    }
    // Rows whose score never read merge into the largest scored group —
    // a missing read is not a conflicting read.
    if (unscored.length > 0) {
      const scored = [...byScore.values()].sort(
        (a, b) => b.length - a.length,
      )[0];
      if (scored) {
        // An unscored sighting may carry the only clean rank — donate it
        // to the scored row rather than flag a fake disagreement.
        if (scored.every((r) => r.observedRank == null)) {
          const donor = unscored.find((r) => r.observedRank != null);
          if (donor) scored[0]!.observedRank = donor.observedRank;
        }
        scored.push(...unscored);
      } else {
        byScore.set("?", unscored);
      }
    }
    for (const list of byScore.values()) {
      const ranks = new Set(list.map((row) => row.observedRank ?? -1));
      const kept = list[0]!;
      if (ranks.size > 1) {
        kept.observedRank = null;
        kept.needsReview = true;
        kept.reviewReason = kept.reviewReason ?? "rank_disagreement";
      }
      kept.ocrName = cluster.displayName;
      const reason = list.find((row) => row.reviewReason)?.reviewReason;
      if (reason) {
        kept.reviewReason = kept.reviewReason ?? reason;
        kept.needsReview = true;
      }
      if (kept.ocrName === "?") {
        kept.needsReview = true;
        kept.reviewReason = kept.reviewReason ?? "name_unreadable";
      }
      // A flagged row never emits a confident (possibly wrong) rank.
      if (kept.needsReview) kept.observedRank = null;
      emitted.add(kept);
    }
  }
  for (const row of order) {
    if (row.kind === "leaderboard" && !emitted.has(row)) continue;
    finalRows.push(row);
  }
  // Leaderboard scores are unique per member — the same score on two
  // emitted rows means an unreadable name split one member's sightings.
  const scoreGroups = new Map<string, WarzoneParsedRow[]>();
  for (const row of finalRows) {
    if (row.kind !== "leaderboard" || row.realScore == null) continue;
    const list = scoreGroups.get(row.realScore) ?? [];
    list.push(row);
    scoreGroups.set(row.realScore, list);
  }
  for (const list of scoreGroups.values()) {
    if (list.length < 2) continue;
    for (const row of list) {
      row.needsReview = true;
      row.reviewReason = row.reviewReason ?? "duplicate_score";
      row.observedRank = null;
    }
  }
  for (const row of finalRows) {
    if (row.reviewReason) {
      reviewFlags.add(
        fuzzyWarzoneNameKey(row.ocrName) ||
          sanitizedNameKey(row.ocrName, options?.allianceTag),
      );
    }
  }

  const pollConflicts: string[] = [];
  // Multi-frame sources (video): a poll member must appear in at least two
  // sampled frames — single-frame names are OCR noise (badge fragments,
  // partial scroll rows), not members. Stills (1–2 frames) keep every row.
  const multiFrameSource =
    new Set(frames.map((f) => f.frameIndex)).size >= 4;
  const keptPollRows = new Set<WarzoneParsedRow>();
  for (const cluster of pollClusters) {
    const corroborated = !multiFrameSource || cluster.frameSpan.size >= 2;
    const options = new Set(
      cluster.rows
        .map((row) => row.pollOption)
        .filter((o): o is 1 | 2 => o != null),
    );
    if (options.size > 1) {
      pollConflicts.push(cluster.displayName);
      for (const row of cluster.rows) row.needsReview = true;
    }
    if (corroborated) {
      for (const row of cluster.rows) {
        row.ocrName = cluster.displayName;
        keptPollRows.add(row);
      }
    }
  }

  return {
    rows: finalRows.filter((row) => row.kind === "leaderboard" || keptPollRows.has(row)),
    conflicts,
    pollConflicts,
    reviewFlags: [...reviewFlags],
  };
}
