/**
 * Deposit-slip cross-frame dedupe: fuzzy commander first, depositAt as
 * corroboration.
 *
 * Primary partition is fuzzy commander name across the whole job (not
 * to-the-minute timestamp). Within a name cluster, nearby / majority-agreeing
 * timestamps auto-merge; genuinely distant timestamps (same commander deposited
 * twice) split into separate slips. Missing or implausible timestamps fold into
 * the matching name group when unambiguous.
 *
 * This module is a thin domain adapter over the generic helpers in
 * `src/lib/video/dedupe/`: it supplies deposit-slip field specs (amount, term,
 * alliance tag, server number) and coalescing policy (status/outcome merge), and
 * delegates clustering, majority-vote conflict resolution, and missing-timestamp
 * reconciliation to the shared, domain-agnostic engine pieces.
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

/**
 * Max gap between depositAts that still count as the same slip within a
 * same-name cluster. Catches OCR minute-digit noise (e.g. 13:18 vs 13:28)
 * without merging a commander who genuinely deposited hours apart.
 */
export const DEPOSIT_AT_PROXIMITY_MS = 15 * 60 * 1000;

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

/** Prefer higher completeness; break ties with OCR confidence when present. */
function compareSlipQuality(
  a: ParsedDepositSlipDraft,
  b: ParsedDepositSlipDraft,
): number {
  const completeness = completenessScore(b) - completenessScore(a);
  if (completeness !== 0) return completeness;
  return (b.confidence ?? -1) - (a.confidence ?? -1);
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
  const ranked = [...slips].sort(compareSlipQuality);
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
    if (
      typeof s.confidence === "number" &&
      (dest.confidence == null || s.confidence > dest.confidence)
    ) {
      dest.confidence = s.confidence;
    }
  }

  // Seek / Follow-me targets the earliest frame in the merged group, not the
  // completeness-winner's frame (which may be a later re-OCR of the same slip).
  let minFrame: number | null = null;
  for (const s of slips) {
    if (
      s.sourceFrameIndex != null &&
      (minFrame == null || s.sourceFrameIndex < minFrame)
    ) {
      minFrame = s.sourceFrameIndex;
    }
  }
  dest.sourceFrameIndex = minFrame ?? undefined;

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
  return group.slice().sort(compareSlipQuality)[0]!.slipId;
}

function parseDepositAtMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True when one to-the-minute key accounts for a strict majority of the
 * timestamped rows in a same-name cluster (OCR outliers lose to the crowd).
 */
function hasMajorityMinuteKey(
  slips: readonly ParsedDepositSlipDraft[],
): boolean {
  const keys = slips
    .map((s) => toMinuteTimestampKey(s.depositAt))
    .filter((k): k is string => k != null);
  if (keys.length === 0) return false;
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const majorityThreshold = keys.length / 2;
  for (const count of counts.values()) {
    if (count > majorityThreshold) return true;
  }
  return false;
}

/**
 * Split timestamped rows into proximity-connected subgroups (sorted union of
 * neighbors within `proximityMs`). Rows without a parseable timestamp are
 * returned separately as `unanchored`.
 */
export function splitByDepositAtProximity<T>(
  rows: readonly T[],
  getTs: (row: T) => string | null | undefined,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): { anchoredGroups: T[][]; unanchored: T[] } {
  const unanchored: T[] = [];
  const anchored: { row: T; ms: number }[] = [];
  for (const row of rows) {
    const ms = parseDepositAtMs(getTs(row) ?? null);
    if (ms == null) {
      unanchored.push(row);
    } else {
      anchored.push({ row, ms });
    }
  }
  if (anchored.length === 0) {
    return { anchoredGroups: [], unanchored };
  }

  anchored.sort((a, b) => a.ms - b.ms);
  const groups: T[][] = [];
  let current: T[] = [anchored[0]!.row];
  let prevMs = anchored[0]!.ms;
  for (let i = 1; i < anchored.length; i += 1) {
    const next = anchored[i]!;
    if (next.ms - prevMs <= proximityMs) {
      current.push(next.row);
    } else {
      groups.push(current);
      current = [next.row];
    }
    prevMs = next.ms;
  }
  groups.push(current);
  return { anchoredGroups: groups, unanchored };
}

type DedupeAccum = {
  clusters: DedupeCluster[];
  consumed: Set<string>;
  output: IndexedSlip[];
  conflictFields: readonly ConflictFieldSpec<ParsedDepositSlipDraft>[];
};

function emitAutoMerged(
  accum: DedupeAccum,
  group: readonly IndexedSlip[],
  reason: string,
  corrections: readonly FieldCorrection[],
): void {
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
  const clusterId = `c_${nextSlipId()}`;
  accum.clusters.push({
    clusterId,
    disposition: "auto_merged",
    reason,
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
  accum.output.push(destination);
  for (const s of group) accum.consumed.add(s.slipId);
  // Destination is a synthetic review row — mark it consumed so later passes
  // don't treat it as an open OCR source.
  accum.consumed.add(destinationSlipId);
}

function emitFlagged(
  accum: DedupeAccum,
  group: readonly IndexedSlip[],
  reason: string,
): void {
  const clusterId = `c_${nextSlipId()}`;
  accum.clusters.push({
    clusterId,
    disposition: "flagged",
    reason,
    destinationSlipId: pickBestSlipId(group),
    members: group.map((s) => ({
      slipId: s.slipId,
      snapshot: slipSnapshot(s),
    })),
  });
  for (const s of group) {
    accum.output.push({ ...s, dedupeClusterId: clusterId });
    accum.consumed.add(s.slipId);
  }
}

/**
 * Merge or flag a same-name (and same-deposit) subgroup after conflict resolution.
 */
function resolveNameTimestampGroup(
  accum: DedupeAccum,
  group: readonly IndexedSlip[],
  autoMergeReason: string,
): void {
  if (group.length === 0) return;
  if (group.length === 1) {
    const only = group[0]!;
    if (!accum.consumed.has(only.slipId)) {
      accum.output.push(only);
      accum.consumed.add(only.slipId);
    }
    return;
  }

  const conflictResolution = resolveGroupConflicts(group, accum.conflictFields);
  if (!conflictResolution.resolved) {
    emitFlagged(accum, group, pickConflictFlagReason(conflictResolution.conflictingFields));
    return;
  }

  const minPair = minPairwiseNameSimilarity(group);
  if (minPair < FUZZY_AUTO_MERGE_THRESHOLD) {
    emitFlagged(accum, group, "borderline_commander_name_same_minute");
    return;
  }

  const corrections = conflictResolution.corrections;
  emitAutoMerged(
    accum,
    group,
    corrections.length > 0
      ? `${autoMergeReason}_majority_corrected`
      : autoMergeReason,
    corrections,
  );
}

/**
 * Within an exact-normalized-name cluster: majority/nearby timestamps merge;
 * distant timestamps split into separate slips; unanchored rows fold when
 * unambiguous. Singletons are left unconsumed so a later same-minute fuzzy
 * pass can still pair OCR name variants (e.g. gondrong / gondronq).
 */
function processExactNameCluster(
  accum: DedupeAccum,
  nameCluster: readonly IndexedSlip[],
): void {
  if (nameCluster.length <= 1) {
    return;
  }

  const timestamped = nameCluster.filter(
    (s) => toMinuteTimestampKey(s.depositAt) != null,
  );
  const unanchored = nameCluster.filter(
    (s) => toMinuteTimestampKey(s.depositAt) == null,
  );

  if (timestamped.length === 0) {
    // Name-only group with no usable timestamps — merge or flag among themselves.
    resolveNameTimestampGroup(
      accum,
      unanchored,
      "commander_match_missing_timestamp",
    );
    return;
  }

  if (hasMajorityMinuteKey(timestamped) || timestamped.length === 1) {
    resolveNameTimestampGroup(
      accum,
      [...timestamped, ...unanchored],
      unanchored.length > 0 && timestamped.length === 1
        ? "commander_match_missing_timestamp"
        : "same_commander_and_minute_timestamp",
    );
    return;
  }

  const { anchoredGroups } = splitByDepositAtProximity(
    timestamped,
    (s) => s.depositAt,
  );

  if (anchoredGroups.length === 1) {
    resolveNameTimestampGroup(
      accum,
      [...anchoredGroups[0]!, ...unanchored],
      unanchored.length > 0
        ? "commander_match_missing_timestamp"
        : "same_commander_and_minute_timestamp",
    );
    return;
  }

  // Multiple distant deposits for the same commander name.
  for (const subgroup of anchoredGroups) {
    resolveNameTimestampGroup(
      accum,
      subgroup,
      "same_commander_and_minute_timestamp",
    );
  }
  if (unanchored.length === 0) return;

  // Unanchored rows with several possible deposits → ambiguous review flag.
  if (unanchored.length >= 1 && anchoredGroups.length > 1) {
    emitFlagged(
      accum,
      unanchored,
      "commander_match_missing_timestamp_ambiguous",
    );
    return;
  }
  resolveNameTimestampGroup(
    accum,
    unanchored,
    "commander_match_missing_timestamp",
  );
}

/**
 * Collapse cross-frame deposit-slip OCR duplicates.
 *
 * Primary partition is **exact normalized commander name** across the whole
 * job (so OCR-misread minutes for the same commander still meet). Within a
 * name group, nearby / majority-agreeing timestamps auto-merge; genuinely
 * distant timestamps split. Fuzzy name variants (OCR typos) still merge only
 * when they share a to-the-minute timestamp — that keeps unrelated lookalike
 * names from chaining across a flood wave. Missing or implausible timestamps
 * fold into the matching name group when unambiguous.
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

  const accum: DedupeAccum = {
    clusters: [],
    consumed: new Set<string>(),
    output: [],
    conflictFields,
  };

  // Implausible timestamps (e.g. year 0256) must not form their own proximity
  // subgroup — strip the bad depositAt so they fold as unanchored into the
  // matching name cluster.
  const parseable = input.filter((s) => toMinuteTimestampKey(s.depositAt) != null);
  const neverTimestamped = input.filter(
    (s) => toMinuteTimestampKey(s.depositAt) == null,
  );
  const { plausible: withPlausibleTs, implausible: implausibleTs } =
    partitionPlausibleTimestamps(parseable, (s) => s.depositAt);
  const demotedImplausible: IndexedSlip[] = implausibleTs.map((s) => ({
    ...s,
    depositAt: null,
  }));
  const workingPool: IndexedSlip[] = [
    ...withPlausibleTs,
    ...neverTimestamped,
    ...demotedImplausible,
  ];

  // Primary partition: exact normalized commander name (job-wide).
  const byExactName = new Map<string, IndexedSlip[]>();
  const emptyNameRows: IndexedSlip[] = [];
  for (const slip of workingPool) {
    const key = normalizeEntityName(slip.identity.commanderName);
    if (!key) {
      emptyNameRows.push(slip);
      continue;
    }
    const bucket = byExactName.get(key);
    if (bucket) bucket.push(slip);
    else byExactName.set(key, [slip]);
  }

  for (const nameCluster of byExactName.values()) {
    processExactNameCluster(accum, nameCluster);
  }
  for (const slip of emptyNameRows) {
    if (!accum.consumed.has(slip.slipId)) {
      accum.output.push(slip);
      accum.consumed.add(slip.slipId);
    }
  }

  // Fuzzy OCR name variants still require a shared minute — otherwise short
  // lookalike names (Filler0/Filler1) chain across an entire flood wave.
  // Include already-emitted same-minute destinations so a fuzzy variant can
  // still fold into an exact-name merge that already ran (gondrong → gondronq).
  const remainingForFuzzy = workingPool.filter(
    (s) => !accum.consumed.has(s.slipId),
  );
  const outputByMinute = groupByMinuteTimestamp(
    accum.output.filter((s) => toMinuteTimestampKey(s.depositAt) != null),
    (s) => s.depositAt,
  );
  const openByMinute = groupByMinuteTimestamp(
    remainingForFuzzy.filter((s) => toMinuteTimestampKey(s.depositAt) != null),
    (s) => s.depositAt,
  );

  const minuteKeys = new Set([
    ...outputByMinute.keys(),
    ...openByMinute.keys(),
  ]);

  for (const minuteKey of minuteKeys) {
    const open = openByMinute.get(minuteKey) ?? [];
    const destinationsHere = outputByMinute.get(minuteKey) ?? [];
    if (open.length === 0) continue;

    const pool = [...open, ...destinationsHere];
    const autoClusters = clusterByFuzzyName(
      pool,
      (s) => s.identity.commanderName,
      { threshold: FUZZY_AUTO_MERGE_THRESHOLD, includeSingletons: false },
    );

    const assignedOpen = new Set<string>();
    for (const group of autoClusters) {
      const sources = group.filter((s) =>
        open.some((o) => o.slipId === s.slipId),
      );
      const dests = group.filter((s) =>
        destinationsHere.some((d) => d.slipId === s.slipId),
      );
      if (sources.length === 0) continue;

      if (dests.length === 1) {
        const destination = accum.output.find(
          (o) => o.slipId === dests[0]!.slipId,
        )!;
        const conflictResolution = resolveGroupConflicts(
          [...sources, destination],
          conflictFields,
        );
        if (!conflictResolution.resolved) {
          emitFlagged(
            accum,
            sources,
            pickConflictFlagReason(conflictResolution.conflictingFields),
          );
          for (const s of sources) assignedOpen.add(s.slipId);
          continue;
        }
        const corrections = conflictResolution.corrections;
        const merged = applyDepositSlipCorrections(
          coalesceDepositSlips([...sources, destination]),
          corrections,
        );
        const rebuilt: IndexedSlip = {
          ...merged,
          depositAt: destination.depositAt,
          identity: { ...merged.identity },
          slipId: destination.slipId,
          dedupeClusterId: destination.dedupeClusterId,
        };
        const outputIndex = accum.output.findIndex(
          (o) => o.slipId === destination.slipId,
        );
        if (outputIndex >= 0) accum.output[outputIndex] = rebuilt;

        const existingFlagged = destination.dedupeClusterId
          ? accum.clusters.find(
              (c) =>
                c.clusterId === destination.dedupeClusterId &&
                c.disposition === "flagged",
            )
          : undefined;
        if (existingFlagged) {
          existingFlagged.members.push(
            ...sources.map((s) => ({
              slipId: s.slipId,
              snapshot: slipSnapshot(s),
            })),
          );
        } else {
          const clusterId = `c_${nextSlipId()}`;
          accum.clusters.push({
            clusterId,
            disposition: "auto_merged",
            reason:
              corrections.length > 0
                ? "same_commander_and_minute_timestamp_majority_corrected"
                : "same_commander_and_minute_timestamp",
            destinationSlipId: destination.slipId,
            ...(corrections.length > 0
              ? { correctedFields: corrections.map((c) => c.key) }
              : {}),
            members: [
              ...sources.map((s) => ({
                slipId: s.slipId,
                snapshot: slipSnapshot(s),
              })),
              {
                slipId: destination.slipId,
                snapshot: slipSnapshot(rebuilt),
              },
            ],
          });
        }
        for (const s of sources) {
          accum.consumed.add(s.slipId);
          assignedOpen.add(s.slipId);
        }
        continue;
      }

      if (dests.length > 1) {
        emitFlagged(
          accum,
          sources,
          "commander_match_missing_timestamp_ambiguous",
        );
        for (const s of sources) assignedOpen.add(s.slipId);
        continue;
      }

      // No existing destination — merge/flag the open sources alone.
      resolveNameTimestampGroup(
        accum,
        sources,
        "same_commander_and_minute_timestamp",
      );
      for (const s of sources) assignedOpen.add(s.slipId);
    }

    const remainingInMinute = open.filter(
      (s) => !assignedOpen.has(s.slipId) && !accum.consumed.has(s.slipId),
    );
    const borderline = clusterByFuzzyName(
      remainingInMinute,
      (s) => s.identity.commanderName,
      { threshold: FUZZY_FLAG_MIN_THRESHOLD, includeSingletons: false },
    );
    for (const group of borderline) {
      const stillOpen = group.filter((s) => !accum.consumed.has(s.slipId));
      if (stillOpen.length < 2) continue;
      const minPair = minPairwiseNameSimilarity(stillOpen);
      if (minPair >= FUZZY_AUTO_MERGE_THRESHOLD) continue;
      emitFlagged(accum, stillOpen, "borderline_commander_name_same_minute");
    }
  }

  // Fold leftover unanchored rows into a unique same-name (fuzzy) destination
  // when unambiguous — covers timestamp-less OCR of a fuzzy name variant.
  const leftoverUnanchored = workingPool.filter(
    (s) =>
      !accum.consumed.has(s.slipId) &&
      toMinuteTimestampKey(s.depositAt) == null,
  );
  if (leftoverUnanchored.length > 0) {
    const destinations = accum.output.slice();
    const reconciliation = reconcileMissingAnchorRows(
      leftoverUnanchored,
      destinations,
      {
        getName: (s) => s.identity.commanderName,
        isCompatible: (rows) =>
          resolveGroupConflicts(rows, conflictFields).resolved,
      },
    );

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
        depositAt: destination.depositAt,
        identity: { ...merged.identity },
        slipId: destination.slipId,
        dedupeClusterId: destination.dedupeClusterId,
      };
      const outputIndex = accum.output.findIndex(
        (o) => o.slipId === destination.slipId,
      );
      if (outputIndex >= 0) accum.output[outputIndex] = rebuilt;

      const existingFlaggedCluster = destination.dedupeClusterId
        ? accum.clusters.find(
            (cluster) =>
              cluster.clusterId === destination.dedupeClusterId &&
              cluster.disposition === "flagged",
          )
        : undefined;
      if (existingFlaggedCluster) {
        existingFlaggedCluster.members.push(
          ...anchorlessRows.map((s) => ({
            slipId: s.slipId,
            snapshot: slipSnapshot(s),
          })),
        );
        for (const s of anchorlessRows) accum.consumed.add(s.slipId);
        continue;
      }

      const clusterId = `c_${nextSlipId()}`;
      accum.clusters.push({
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
      for (const s of anchorlessRows) accum.consumed.add(s.slipId);
    }

    for (const group of reconciliation.mergedAmongThemselves) {
      const open = group.filter((s) => !accum.consumed.has(s.slipId));
      if (open.length < 2) continue;
      resolveNameTimestampGroup(
        accum,
        open,
        "commander_match_missing_timestamp",
      );
    }

    for (const { group, matchedDestinations } of reconciliation.ambiguous) {
      const open = group.filter((s) => !accum.consumed.has(s.slipId));
      if (open.length === 0) continue;

      const destinationClusterIds = new Set(
        matchedDestinations
          .map((d) => d.dedupeClusterId)
          .filter((id): id is string => !!id),
      );
      const existingCluster =
        matchedDestinations.length > 0 &&
        destinationClusterIds.size === 1 &&
        matchedDestinations.every((d) => !!d.dedupeClusterId)
          ? accum.clusters.find(
              (c) => c.clusterId === [...destinationClusterIds][0],
            )
          : undefined;

      if (existingCluster) {
        existingCluster.members.push(
          ...open.map((s) => ({
            slipId: s.slipId,
            snapshot: slipSnapshot(s),
          })),
        );
        for (const s of open) {
          accum.output.push({ ...s, dedupeClusterId: existingCluster.clusterId });
          accum.consumed.add(s.slipId);
        }
        continue;
      }

      emitFlagged(accum, open, "commander_match_missing_timestamp_ambiguous");
    }
  }

  // Safety: anything not yet emitted passes through.
  for (const s of workingPool) {
    if (!accum.consumed.has(s.slipId)) {
      accum.output.push(s);
      accum.consumed.add(s.slipId);
    }
  }

  const autoMergedRemoved = Math.max(0, input.length - accum.output.length);

  const report: DedupeReport = {
    clusters: accum.clusters,
    autoMergedCount: autoMergedRemoved,
    flaggedCount: accum.clusters.filter((c) => c.disposition === "flagged")
      .length,
    inputCount: input.length,
    outputCount: accum.output.length,
  };

  return {
    slips: sortByDepositAtDesc(accum.output),
    report,
  };
}
