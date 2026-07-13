/**
 * Deposit-slip cross-frame dedupe: fuzzy commander + to-the-minute timestamp.
 *
 * This module is a thin domain adapter over the generic helpers in
 * `src/lib/video/dedupe/`: it supplies deposit-slip field specs (amount, term,
 * alliance tag, server number) and coalescing policy (status/outcome merge), and
 * delegates clustering, majority-vote conflict resolution, and missing-timestamp
 * reconciliation to the shared, domain-agnostic engine pieces. Future OCR history
 * dedupe (bank stronghold lists, event scores, train cargo, ...) can follow the
 * same pattern.
 */

import { nanoid } from "nanoid";

import type { ParsedDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import {
  resolveGroupConflicts,
  type ConflictFieldSpec,
  type FieldCorrection,
} from "@/lib/video/dedupe/conflict-resolution.shared";
import {
  clusterByFuzzyName,
  FUZZY_AUTO_MERGE_THRESHOLD,
  FUZZY_FLAG_MIN_THRESHOLD,
  normalizeEntityName,
} from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import {
  emptyDedupeReport,
  type DedupeCluster,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import { reconcileMissingAnchorRows } from "@/lib/video/dedupe/missing-anchor-reconciliation.shared";
import {
  groupByMinuteTimestamp,
  toMinuteTimestampKey,
} from "@/lib/video/dedupe/timestamp-collision.shared";
import { partitionPlausibleTimestamps } from "@/lib/video/dedupe/timestamp-plausibility.shared";
import { stringSimilarity } from "@/lib/video/member-matcher";

export type DedupedDepositSlip = ParsedDepositSlipDraft & {
  /** Provisional id — used as parsed_rows.id for survivors. */
  slipId: string;
  /** Set on surviving members of a flagged cluster. */
  dedupeClusterId?: string | null;
};

export type DedupeDepositSlipsResult = {
  slips: DedupedDepositSlip[];
  report: DedupeReport;
};

/** Globally-unique provisional id — safe across concurrent serverless instances. */
function nextSlipId(): string {
  return nanoid(16);
}

/**
 * No-op retained for backward compatibility with existing test imports.
 * IDs are now nanoid-based and require no per-test reset.
 * @deprecated remove callers when convenient
 */
export function resetDepositSlipIdCounterForTests(): void {
  // intentional no-op
}

function slipSnapshot(slip: ParsedDepositSlipDraft): Record<string, unknown> {
  return {
    depositAt: slip.depositAt,
    termDays: slip.termDays,
    amount: slip.amount,
    status: slip.status,
    outcomeAmount: slip.outcomeAmount,
    outcomeKind: slip.outcomeKind,
    commanderName: slip.identity.commanderName,
    allianceTag: slip.identity.allianceTag,
    rawIdentity: slip.identity.rawIdentity,
    sourceFrameIndex: slip.sourceFrameIndex ?? null,
  };
}

function completenessScore(slip: ParsedDepositSlipDraft): number {
  let score = 0;
  if (slip.depositAt) score += 2;
  if (slip.amount != null) score += 2;
  if (slip.termDays != null) score += 2;
  if (slip.identity.commanderName.trim()) score += 1;
  if (slip.identity.allianceTag) score += 1;
  if (slip.outcomeKind) score += 1;
  if (slip.outcomeAmount != null) score += 1;
  if (slip.status === "matured" || slip.status === "looted") score += 1;
  const raw = slip.identity.commanderName;
  const normalized = normalizeEntityName(raw);
  if (normalized && raw.length - normalized.length <= 2) score += 1;
  return score;
}

function normalizeTagForFrequency(tag: string | null | undefined): string | null {
  const trimmed = tag?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function areLikelyAllianceTagOcrVariants(a: unknown, b: unknown): boolean {
  const normalizedA = normalizeTagForFrequency(typeof a === "string" ? a : null);
  const normalizedB = normalizeTagForFrequency(typeof b === "string" ? b : null);
  if (!normalizedA || !normalizedB) return false;

  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  // The batch-frequency signal is only safe for a one-edit OCR variant. A
  // wholly different tag can represent a real same-name identity collision and
  // must remain flagged regardless of how common either tag is in the batch.
  return stringSimilarity(normalizedA, normalizedB) >= 1 - 1 / maxLength;
}

/**
 * Counts how often each alliance tag appears across the *whole* batch. Used as
 * a tiebreaker when a cluster has a genuine local tie on `allianceTag` (e.g. a
 * 1-of-2 split) — a tag that shows up 49 times elsewhere in the same job is
 * almost certainly correct next to a lookalike that shows up once or twice
 * (single-character OCR noise, e.g. "LFgo" vs "LFga").
 */
function buildAllianceTagFrequency(
  slips: readonly ParsedDepositSlipDraft[],
): Map<string, number> {
  const freq = new Map<string, number>();
  for (const s of slips) {
    const tag = normalizeTagForFrequency(s.identity.allianceTag);
    if (!tag) continue;
    freq.set(tag, (freq.get(tag) ?? 0) + 1);
  }
  return freq;
}

/**
 * Fields checked for cross-frame conflicts within a matched commander+minute
 * (or matched-by-name-only) group. A single OCR-garbled character (e.g. an
 * alliance tag `o`/`a` mix-up) shouldn't flag an entire cluster when the rest of
 * the group clearly agrees — that's what `resolveGroupConflicts` + majority vote
 * is for. Genuine ties (no majority) fall back to the tag-frequency tiebreaker
 * for `allianceTag` (see `buildAllianceTagFrequency`), and still flag if that
 * doesn't clearly resolve it either.
 */
function buildDepositSlipConflictFields(
  tagFrequency: Map<string, number>,
): readonly ConflictFieldSpec<ParsedDepositSlipDraft>[] {
  return [
    {
      key: "allianceTag",
      get: (s) => s.identity.allianceTag,
      isEqual: (a, b) =>
        String(a).trim().toLowerCase() === String(b).trim().toLowerCase(),
      tieBreaker: {
        score: (value) =>
          tagFrequency.get(
            normalizeTagForFrequency(typeof value === "string" ? value : null) ?? "",
          ) ?? 0,
        canResolve: (winner, alternatives) =>
          alternatives.every((alternative) =>
            areLikelyAllianceTagOcrVariants(winner, alternative),
          ),
      },
    },
    {
      key: "gameServerNumber",
      get: (s) => s.identity.gameServerNumber,
    },
    {
      key: "amount",
      get: (s) => s.amount,
    },
    {
      key: "termDays",
      get: (s) => s.termDays,
    },
  ];
}

const IDENTITY_CONFLICT_FIELD_KEYS = new Set(["allianceTag", "gameServerNumber"]);

/** Mirrors the historical two-reason split so existing UI copy keeps working. */
function pickConflictFlagReason(conflictingFields: readonly string[]): string {
  if (conflictingFields.some((key) => IDENTITY_CONFLICT_FIELD_KEYS.has(key))) {
    return "same_commander_timestamp_conflicting_identity";
  }
  return "same_commander_timestamp_conflicting_amount_or_term";
}

function applyDepositSlipCorrections(
  slip: ParsedDepositSlipDraft,
  corrections: readonly FieldCorrection[],
): ParsedDepositSlipDraft {
  if (corrections.length === 0) return slip;
  const next: ParsedDepositSlipDraft = { ...slip, identity: { ...slip.identity } };
  for (const correction of corrections) {
    switch (correction.key) {
      case "amount":
        next.amount = correction.value as ParsedDepositSlipDraft["amount"];
        break;
      case "termDays":
        next.termDays = correction.value as ParsedDepositSlipDraft["termDays"];
        break;
      case "allianceTag":
        next.identity.allianceTag = correction.value as string;
        break;
      case "gameServerNumber":
        next.identity.gameServerNumber = correction.value as number;
        break;
      default:
        break;
    }
  }
  return next;
}

function minPairwiseNameSimilarity(
  slips: readonly ParsedDepositSlipDraft[],
): number {
  let minPair = 1;
  let compared = false;
  for (let i = 0; i < slips.length; i += 1) {
    for (let j = i + 1; j < slips.length; j += 1) {
      const a = normalizeEntityName(slips[i]!.identity.commanderName);
      const b = normalizeEntityName(slips[j]!.identity.commanderName);
      if (!a || !b) continue;
      compared = true;
      minPair = Math.min(minPair, stringSimilarity(a, b));
    }
  }
  return compared ? minPair : 0;
}

function pickCleanerIdentity(
  a: ParsedDepositSlipDraft["identity"],
  b: ParsedDepositSlipDraft["identity"],
): ParsedDepositSlipDraft["identity"] {
  const aNorm = normalizeEntityName(a.commanderName);
  const bNorm = normalizeEntityName(b.commanderName);
  const aJunk = a.commanderName.length - aNorm.length;
  const bJunk = b.commanderName.length - bNorm.length;
  if (bJunk < aJunk) return { ...b };
  if (aJunk < bJunk) return { ...a };
  if (bNorm.length > aNorm.length) return { ...b };
  return { ...a };
}

export function coalesceDepositSlips(
  slips: readonly ParsedDepositSlipDraft[],
): ParsedDepositSlipDraft {
  if (slips.length === 0) {
    throw new Error("coalesceDepositSlips requires at least one slip");
  }
  const ranked = [...slips].sort(
    (a, b) => completenessScore(b) - completenessScore(a),
  );
  const dest: ParsedDepositSlipDraft = {
    ...ranked[0]!,
    identity: { ...ranked[0]!.identity },
  };

  for (const s of ranked.slice(1)) {
    if (!dest.depositAt && s.depositAt) dest.depositAt = s.depositAt;
    if (dest.amount == null && s.amount != null) dest.amount = s.amount;
    if (dest.termDays == null && s.termDays != null) dest.termDays = s.termDays;

    if (
      dest.status === "locked" &&
      (s.status === "matured" || s.status === "looted")
    ) {
      dest.status = s.status;
      dest.outcomeKind = s.outcomeKind ?? dest.outcomeKind;
      dest.outcomeAmount = s.outcomeAmount ?? dest.outcomeAmount;
    } else if (!dest.outcomeKind && s.outcomeKind) {
      dest.outcomeKind = s.outcomeKind;
      dest.outcomeAmount = s.outcomeAmount;
      if (s.status !== "locked") dest.status = s.status;
    } else if (dest.outcomeAmount == null && s.outcomeAmount != null) {
      dest.outcomeAmount = s.outcomeAmount;
    }

    dest.identity = pickCleanerIdentity(dest.identity, s.identity);
    if (!dest.identity.allianceTag && s.identity.allianceTag) {
      dest.identity.allianceTag = s.identity.allianceTag;
    }
    if (
      dest.identity.gameServerNumber == null &&
      s.identity.gameServerNumber != null
    ) {
      dest.identity.gameServerNumber = s.identity.gameServerNumber;
    }
    if (dest.sourceFrameIndex == null && s.sourceFrameIndex != null) {
      dest.sourceFrameIndex = s.sourceFrameIndex;
    }
  }

  return dest;
}

function sortByDepositAtDesc(slips: DedupedDepositSlip[]): DedupedDepositSlip[] {
  return [...slips].sort((a, b) => {
    const aMs = a.depositAt ? Date.parse(a.depositAt) : 0;
    const bMs = b.depositAt ? Date.parse(b.depositAt) : 0;
    return bMs - aMs;
  });
}

type IndexedSlip = DedupedDepositSlip;

function makeIndexed(slips: readonly ParsedDepositSlipDraft[]): IndexedSlip[] {
  return slips.map((slip) => ({
    ...slip,
    identity: { ...slip.identity },
    slipId: nextSlipId(),
  }));
}

function pickBestSlipId(group: readonly IndexedSlip[]): string {
  return group
    .slice()
    .sort((a, b) => completenessScore(b) - completenessScore(a))[0]!.slipId;
}

/**
 * Collapse cross-frame deposit-slip OCR duplicates.
 *
 * Auto-merge: same fuzzy commander + same to-the-minute timestamp, and either
 * every field agrees or every disagreeing field has a clear majority — or, for
 * `allianceTag` specifically, a batch-wide frequency tiebreak on a genuine
 * local tie (the minority/rare reading is treated as OCR noise and corrected).
 * Flag: borderline fuzzy names sharing a minute, or a genuine field conflict
 * with no majority and no decisive tiebreak (e.g. a 2-2 split). Distinct,
 * dissimilar commanders that merely share a deposit minute are *not* flagged —
 * that's normal during a deposit flood wave, not evidence of duplication.
 * A parseable-but-implausible timestamp (e.g. a garbled year) is treated like
 * a missing one. Rows with no usable timestamp get one more pass: fold into a
 * matching same-named cluster/row if exactly one exists (or merge with each
 * other), fold into an already-flagged cluster if all matching candidates
 * already dispute the same identity, otherwise flag as ambiguous, otherwise
 * pass through unchanged.
 */
export function dedupeDepositSlips(
  slips: readonly ParsedDepositSlipDraft[],
): DedupeDepositSlipsResult {
  const input = makeIndexed(slips);
  if (input.length <= 1) {
    return {
      slips: sortByDepositAtDesc(input),
      report: emptyDedupeReport(input.length),
    };
  }

  const conflictFields = buildDepositSlipConflictFields(
    buildAllianceTagFrequency(slips),
  );

  const clusters: DedupeCluster[] = [];
  const consumed = new Set<string>();
  const output: IndexedSlip[] = [];

  const parseable = input.filter((s) => toMinuteTimestampKey(s.depositAt) != null);
  const neverTimestamped = input.filter(
    (s) => toMinuteTimestampKey(s.depositAt) == null,
  );
  // A parseable timestamp can still be an OCR digit-transposition outlier (e.g.
  // "2026" misread as "0256") — that row would otherwise anchor its own,
  // unrelated per-minute bucket and never get compared against its actual
  // duplicate. Route implausible outliers through the same missing-anchor
  // reconciliation pass as rows with no timestamp at all.
  const { plausible: withTs, implausible: implausibleTs } =
    partitionPlausibleTimestamps(parseable, (s) => s.depositAt);
  const withoutTs = [...neverTimestamped, ...implausibleTs];

  const byMinute = groupByMinuteTimestamp(withTs, (s) => s.depositAt);

  for (const [, minuteGroup] of byMinute) {
    if (minuteGroup.length === 1) {
      const only = minuteGroup[0]!;
      if (!consumed.has(only.slipId)) {
        output.push(only);
        consumed.add(only.slipId);
      }
      continue;
    }

    const assignedInMinute = new Set<string>();

    // High-confidence fuzzy clusters within this minute.
    const autoClusters = clusterByFuzzyName(
      minuteGroup,
      (s) => s.identity.commanderName,
      { threshold: FUZZY_AUTO_MERGE_THRESHOLD, includeSingletons: false },
    );

    for (const group of autoClusters) {
      const clusterId = `c_${nextSlipId()}`;
      const conflictResolution = resolveGroupConflicts(group, conflictFields);

      if (!conflictResolution.resolved) {
        clusters.push({
          clusterId,
          disposition: "flagged",
          reason: pickConflictFlagReason(conflictResolution.conflictingFields),
          destinationSlipId: pickBestSlipId(group),
          members: group.map((s) => ({
            slipId: s.slipId,
            snapshot: slipSnapshot(s),
          })),
        });
        for (const s of group) {
          output.push({ ...s, dedupeClusterId: clusterId });
          consumed.add(s.slipId);
          assignedInMinute.add(s.slipId);
        }
        continue;
      }

      const minPair = minPairwiseNameSimilarity(group);
      if (minPair < FUZZY_AUTO_MERGE_THRESHOLD) {
        clusters.push({
          clusterId,
          disposition: "flagged",
          reason: "borderline_commander_name_same_minute",
          destinationSlipId: pickBestSlipId(group),
          members: group.map((s) => ({
            slipId: s.slipId,
            snapshot: slipSnapshot(s),
          })),
        });
        for (const s of group) {
          output.push({ ...s, dedupeClusterId: clusterId });
          consumed.add(s.slipId);
          assignedInMinute.add(s.slipId);
        }
        continue;
      }

      const corrections = conflictResolution.corrections;
      const merged = applyDepositSlipCorrections(
        coalesceDepositSlips(group),
        corrections,
      );
      const destinationSlipId = nextSlipId();
      const destination: IndexedSlip = {
        ...merged,
        identity: { ...merged.identity },
        slipId: destinationSlipId,
      };
      clusters.push({
        clusterId,
        disposition: "auto_merged",
        reason:
          corrections.length > 0
            ? "same_commander_and_minute_timestamp_majority_corrected"
            : "same_commander_and_minute_timestamp",
        destinationSlipId,
        ...(corrections.length > 0
          ? { correctedFields: corrections.map((c) => c.key) }
          : {}),
        members: [
          ...group.map((s) => ({
            slipId: s.slipId,
            snapshot: slipSnapshot(s),
          })),
          {
            slipId: destinationSlipId,
            snapshot: slipSnapshot(destination),
          },
        ],
      });
      output.push(destination);
      for (const s of group) {
        consumed.add(s.slipId);
        assignedInMinute.add(s.slipId);
      }
    }

    // Borderline fuzzy (below auto threshold) within remaining minute rows → flag.
    const remainingAfterAuto = minuteGroup.filter(
      (s) => !assignedInMinute.has(s.slipId),
    );
    const borderline = clusterByFuzzyName(
      remainingAfterAuto,
      (s) => s.identity.commanderName,
      { threshold: FUZZY_FLAG_MIN_THRESHOLD, includeSingletons: false },
    );
    for (const group of borderline) {
      const minPair = minPairwiseNameSimilarity(group);
      // Only flag the borderline band; auto-threshold pairs were already handled.
      if (minPair >= FUZZY_AUTO_MERGE_THRESHOLD) continue;

      const clusterId = `c_${nextSlipId()}`;
      clusters.push({
        clusterId,
        disposition: "flagged",
        reason: "borderline_commander_name_same_minute",
        destinationSlipId: pickBestSlipId(group),
        members: group.map((s) => ({
          slipId: s.slipId,
          snapshot: slipSnapshot(s),
        })),
      });
      for (const s of group) {
        output.push({ ...s, dedupeClusterId: clusterId });
        consumed.add(s.slipId);
        assignedInMinute.add(s.slipId);
      }
    }

    // Remaining rows in this minute weren't fuzzy-similar enough (not even at
    // the lenient borderline threshold) to any other row in the same minute —
    // they're just distinct commanders whose deposits happened to land in the
    // same minute, which is completely normal during a deposit flood wave.
    // Sharing a minute alone is not suspicious; only similar-looking names
    // sharing a minute are (handled by the auto/borderline passes above), so
    // these pass straight through unflagged.
    const stillLeft = minuteGroup.filter(
      (s) => !assignedInMinute.has(s.slipId),
    );
    for (const s of stillLeft) {
      if (!consumed.has(s.slipId)) {
        output.push(s);
        consumed.add(s.slipId);
      }
    }
  }

  // Rows with no parseable timestamp never joined a per-minute cluster above —
  // give them one more chance to fold into a matching commander by name alone.
  // All rows in `output` at this point came from `withTs` (they have a valid
  // timestamp), including auto-merged synthetic destinations whose slipId is
  // NOT in `consumed`. Using the full output avoids incorrectly excluding those
  // synthetic destinations as anchor targets.
  const perMinuteDestinations = output.slice();
  const reconciliation = reconcileMissingAnchorRows(withoutTs, perMinuteDestinations, {
    getName: (s) => s.identity.commanderName,
    isCompatible: (rows) => resolveGroupConflicts(rows, conflictFields).resolved,
  });

  for (const { destination, anchorlessRows } of reconciliation.mergedIntoDestination) {
    const conflictResolution = resolveGroupConflicts(
      [...anchorlessRows, destination],
      conflictFields,
    );
    const corrections = conflictResolution.resolved
      ? conflictResolution.corrections
      : [];
    const merged = applyDepositSlipCorrections(
      coalesceDepositSlips([...anchorlessRows, destination]),
      corrections,
    );
    const rebuilt: IndexedSlip = {
      ...merged,
      // `destination` is the anchored row by construction — its timestamp is
      // the reconciled group's source of truth. An anchorless row can still
      // carry a *parseable* timestamp (e.g. one just demoted for being an
      // implausible outlier), which would otherwise outrank the real anchor
      // in `coalesceDepositSlips`'s generic completeness ranking and clobber
      // the correct depositAt.
      depositAt: destination.depositAt,
      identity: { ...merged.identity },
      slipId: destination.slipId,
    };
    const outputIndex = output.findIndex((o) => o.slipId === destination.slipId);
    if (outputIndex >= 0) output[outputIndex] = rebuilt;

    const clusterId = `c_${nextSlipId()}`;
    clusters.push({
      clusterId,
      disposition: "auto_merged",
      reason: "commander_match_missing_timestamp",
      destinationSlipId: destination.slipId,
      ...(corrections.length > 0
        ? { correctedFields: corrections.map((c) => c.key) }
        : {}),
      members: [
        ...anchorlessRows.map((s) => ({
          slipId: s.slipId,
          snapshot: slipSnapshot(s),
        })),
        { slipId: destination.slipId, snapshot: slipSnapshot(rebuilt) },
      ],
    });
    for (const s of anchorlessRows) consumed.add(s.slipId);
  }

  for (const group of reconciliation.mergedAmongThemselves) {
    const conflictResolution = resolveGroupConflicts(group, conflictFields);
    const corrections = conflictResolution.resolved
      ? conflictResolution.corrections
      : [];
    const merged = applyDepositSlipCorrections(coalesceDepositSlips(group), corrections);
    const destinationSlipId = nextSlipId();
    const destination: IndexedSlip = {
      ...merged,
      identity: { ...merged.identity },
      slipId: destinationSlipId,
    };
    const clusterId = `c_${nextSlipId()}`;
    clusters.push({
      clusterId,
      disposition: "auto_merged",
      reason: "commander_match_missing_timestamp",
      destinationSlipId,
      ...(corrections.length > 0
        ? { correctedFields: corrections.map((c) => c.key) }
        : {}),
      members: [
        ...group.map((s) => ({ slipId: s.slipId, snapshot: slipSnapshot(s) })),
        { slipId: destinationSlipId, snapshot: slipSnapshot(destination) },
      ],
    });
    output.push(destination);
    for (const s of group) consumed.add(s.slipId);
  }

  for (const { group, matchedDestinations } of reconciliation.ambiguous) {
    // If every matched destination already belongs to one existing flagged
    // cluster (e.g. two near-identical names sharing a minute, already
    // flagged as `borderline_commander_name_same_minute` against each other),
    // the anchorless row isn't a *new* ambiguity — it's more evidence for the
    // same disputed identity. Fold it into that cluster instead of opening a
    // redundant one, so officer review sees one grouped decision, not two.
    const destinationClusterIds = new Set(
      matchedDestinations.map((d) => d.dedupeClusterId).filter((id): id is string => !!id),
    );
    const existingCluster =
      matchedDestinations.length > 1 &&
      destinationClusterIds.size === 1 &&
      matchedDestinations.every((d) => !!d.dedupeClusterId)
        ? clusters.find((c) => c.clusterId === [...destinationClusterIds][0])
        : undefined;

    if (existingCluster) {
      existingCluster.members.push(
        ...group.map((s) => ({ slipId: s.slipId, snapshot: slipSnapshot(s) })),
      );
      for (const s of group) {
        output.push({ ...s, dedupeClusterId: existingCluster.clusterId });
        consumed.add(s.slipId);
      }
      continue;
    }

    const clusterId = `c_${nextSlipId()}`;
    clusters.push({
      clusterId,
      disposition: "flagged",
      reason: "commander_match_missing_timestamp_ambiguous",
      destinationSlipId: pickBestSlipId(group),
      members: group.map((s) => ({ slipId: s.slipId, snapshot: slipSnapshot(s) })),
    });
    for (const s of group) {
      output.push({ ...s, dedupeClusterId: clusterId });
      consumed.add(s.slipId);
    }
  }

  for (const s of reconciliation.untouched) {
    if (!consumed.has(s.slipId)) {
      output.push(s);
      consumed.add(s.slipId);
    }
  }

  for (const s of input) {
    if (!consumed.has(s.slipId)) {
      output.push(s);
      consumed.add(s.slipId);
    }
  }

  // Every input row ends up either as its own output row or folded into another
  // one; the exact "removed by merge" count is simply the size delta. (A
  // cluster-by-cluster tally is fragile once a cluster's "destination" can be a
  // pre-existing row rather than a freshly synthesized one, as happens in the
  // missing-timestamp reconciliation pass above.)
  const autoMergedRemoved = Math.max(0, input.length - output.length);

  const report: DedupeReport = {
    clusters,
    autoMergedCount: autoMergedRemoved,
    flaggedCount: clusters.filter((c) => c.disposition === "flagged").length,
    inputCount: input.length,
    outputCount: output.length,
  };

  return {
    slips: sortByDepositAtDesc(output),
    report,
  };
}
