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

/**
 * Fields checked for cross-frame conflicts within a matched commander+minute
 * (or matched-by-name-only) group. A single OCR-garbled character (e.g. an
 * alliance tag `o`/`a` mix-up) shouldn't flag an entire cluster when the rest of
 * the group clearly agrees — that's what `resolveGroupConflicts` + majority vote
 * is for. Genuine ties (no majority) still fall through to flagging.
 */
const DEPOSIT_SLIP_CONFLICT_FIELDS: readonly ConflictFieldSpec<ParsedDepositSlipDraft>[] =
  [
    {
      key: "allianceTag",
      get: (s) => s.identity.allianceTag,
      isEqual: (a, b) =>
        String(a).trim().toLowerCase() === String(b).trim().toLowerCase(),
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
 * every field agrees or every disagreeing field has a clear majority (the
 * minority reading is treated as OCR noise and corrected).
 * Flag: timestamp collision across different commanders, borderline fuzzy names,
 * or a genuine field conflict with no majority (e.g. a 2-2 split).
 * Rows with no parseable timestamp get one more pass: fold into a matching
 * same-named cluster/row if one exists (or merge with each other), otherwise
 * flag as ambiguous, otherwise pass through unchanged.
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

  const clusters: DedupeCluster[] = [];
  const consumed = new Set<string>();
  const output: IndexedSlip[] = [];

  const withTs = input.filter((s) => toMinuteTimestampKey(s.depositAt) != null);
  const withoutTs = input.filter(
    (s) => toMinuteTimestampKey(s.depositAt) == null,
  );

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
      const conflictResolution = resolveGroupConflicts(
        group,
        DEPOSIT_SLIP_CONFLICT_FIELDS,
      );

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

    // Remaining rows in this minute with distinct commanders → timestamp collision.
    const stillLeft = minuteGroup.filter(
      (s) => !assignedInMinute.has(s.slipId),
    );
    if (stillLeft.length >= 2) {
      const entityKeys = new Set(
        stillLeft.map((s) => normalizeEntityName(s.identity.commanderName)),
      );
      if (entityKeys.size > 1) {
        const clusterId = `c_${nextSlipId()}`;
        clusters.push({
          clusterId,
          disposition: "flagged",
          reason: "timestamp_collision_different_commanders",
          destinationSlipId: pickBestSlipId(stillLeft),
          members: stillLeft.map((s) => ({
            slipId: s.slipId,
            snapshot: slipSnapshot(s),
          })),
        });
        for (const s of stillLeft) {
          output.push({ ...s, dedupeClusterId: clusterId });
          consumed.add(s.slipId);
          assignedInMinute.add(s.slipId);
        }
      } else {
        for (const s of stillLeft) {
          if (!consumed.has(s.slipId)) {
            output.push(s);
            consumed.add(s.slipId);
          }
        }
      }
    } else {
      for (const s of stillLeft) {
        if (!consumed.has(s.slipId)) {
          output.push(s);
          consumed.add(s.slipId);
        }
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
    isCompatible: (rows) =>
      resolveGroupConflicts(rows, DEPOSIT_SLIP_CONFLICT_FIELDS).resolved,
  });

  for (const { destination, anchorlessRows } of reconciliation.mergedIntoDestination) {
    const conflictResolution = resolveGroupConflicts(
      [...anchorlessRows, destination],
      DEPOSIT_SLIP_CONFLICT_FIELDS,
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
    const conflictResolution = resolveGroupConflicts(
      group,
      DEPOSIT_SLIP_CONFLICT_FIELDS,
    );
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

  for (const group of reconciliation.ambiguous) {
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
