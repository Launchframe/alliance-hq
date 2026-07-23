/**
 * Deposit-slip cross-frame dedupe: exact normalized commander name first,
 * depositAt as corroboration.
 *
 * Primary partition is exact normalized commander name across the whole job
 * (not to-the-minute timestamp). Within a name cluster, nearby timestamps
 * auto-merge; a majority-minute home may absorb a lone OCR outlier a bit
 * farther out; genuinely distant multi-row deposits (same commander deposited
 * twice) stay separate. Fuzzy name variants still require a shared minute.
 * Missing or implausible timestamps fold into the matching name group when
 * unambiguous.
 *
 * Known limitation / follow-up (PR #313 Real Steel, partially closed by #353):
 * {@link DEPOSIT_AT_PROXIMITY_MS} (15m diameter) and
 * {@link DEPOSIT_AT_MAJORITY_OUTLIER_MS} (45m singleton absorb) can still
 * coalesce two genuine same-commander deposits when their OCR'd depositAts
 * land inside those windows with matching amount/term. The normal
 * locked → matured lifecycle cannot produce that (terms are 1/3/5 days), but
 * a deposit **can be looted** (`early_termination_refund`) within minutes of
 * depositAt — so a rapid re-deposit after looting is a real false-merge risk.
 * Mitigations in place: majority-outlier absorb is **status-gated** (#353);
 * proximity auto-merge peels locked rows timed after a terminal OCR row
 * (post-outcome re-deposits) out of the diameter group. Remaining lever:
 * frame-index continuity across the scroll.
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
 * Max gap between consecutive depositAts (and max span of a proximity group)
 * that still count as the same slip within a same-name cluster. Catches OCR
 * minute-digit noise (e.g. 13:18 vs 13:28) without chaining many genuine
 * deposits spaced ~10–15 minutes apart into one mega-merge.
 *
 * Follow-up: rapid genuine re-deposits after an early loot can still fall
 * inside this diameter — see module header "Known limitation".
 */
export const DEPOSIT_AT_PROXIMITY_MS = 15 * 60 * 1000;

/**
 * When a minute key has a strict majority of reads for a commander, a lone
 * outlier farther than {@link DEPOSIT_AT_PROXIMITY_MS} but within this window
 * may still fold into that majority (OCR flipped a tens digit). Multi-row
 * distant groups are never absorbed — those are a second real deposit.
 *
 * Follow-up: a **single-read** genuine second deposit (especially after
 * looting within this window) can still be swallowed — see module header
 * "Known limitation".
 */
export const DEPOSIT_AT_MAJORITY_OUTLIER_MS = 45 * 60 * 1000;

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
    outcomeAt: slip.outcomeAt ?? null,
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

/** Officer-visible identity used to force auto-merge / redundant missing-ts absorb. */
export function depositSlipDisplayIdentityKey(
  slip: ParsedDepositSlipDraft,
  opts?: { includeStatus?: boolean },
): string {
  const includeStatus = opts?.includeStatus !== false;
  const name = normalizeEntityName(slip.identity.commanderName);
  const tag = (slip.identity.allianceTag ?? "").trim().toLowerCase();
  const amount = slip.amount == null ? "" : String(slip.amount);
  const term = slip.termDays == null ? "" : String(slip.termDays);
  const status = includeStatus ? slip.status : "";
  return `${name}|${tag}|${amount}|${term}|${status}`;
}

export function haveExactDisplayIdentity(
  slips: readonly ParsedDepositSlipDraft[],
  opts?: { includeStatus?: boolean },
): boolean {
  if (slips.length < 2) return true;
  if (!normalizeEntityName(slips[0]!.identity.commanderName)) return false;
  const first = depositSlipDisplayIdentityKey(slips[0]!, opts);
  return slips.every(
    (s) => depositSlipDisplayIdentityKey(s, opts) === first,
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** OCR slack around exact term maturity (green is termDays after blue). */
const MATURITY_ALIGNMENT_SLACK_MS = 12 * 60 * 60 * 1000;

function parseDepositAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a locked initiate and a terminal OCR row are the same deposit's
 * lifecycle events (not a second deposit / rapid re-deposit).
 */
function canLifecycleMergePair(
  locked: ParsedDepositSlipDraft,
  outcome: ParsedDepositSlipDraft,
): boolean {
  if (outcome.status !== "matured" && outcome.status !== "looted") return false;
  const depositMs = parseDepositAtMs(locked.depositAt);
  const outcomeMs = parseDepositAtMs(outcome.depositAt);
  if (depositMs == null || outcomeMs == null) return false;
  // Outcome cannot precede initiate; a later locked vs earlier loot is a re-deposit.
  if (outcomeMs < depositMs) return false;
  const termDays = locked.termDays ?? outcome.termDays ?? 1;
  const span = outcomeMs - depositMs;
  // Full term plus a day of OCR slack (upper bound).
  if (span > termDays * MS_PER_DAY + MS_PER_DAY) return false;
  if (outcome.status === "matured") {
    // Green must land near depositAt + termDays — not minutes/hours later.
    const expected = termDays * MS_PER_DAY;
    return span >= expected - MATURITY_ALIGNMENT_SLACK_MS;
  }
  return true;
}

function applyLifecycleTimestamps(
  slips: readonly ParsedDepositSlipDraft[],
  merged: ParsedDepositSlipDraft,
): ParsedDepositSlipDraft {
  const isOutcome =
    merged.status === "matured" || merged.status === "looted";
  if (!isOutcome) {
    return { ...merged, outcomeAt: merged.outcomeAt ?? null };
  }

  const lockedTimes = slips
    .filter((s) => s.status === "locked")
    .map((s) => ({ iso: s.depositAt, ms: parseDepositAtMs(s.depositAt) }))
    .filter((t): t is { iso: string; ms: number } => t.ms != null && !!t.iso)
    .sort((a, b) => a.ms - b.ms);
  const outcomeTimes = slips
    .filter((s) => s.status === "matured" || s.status === "looted")
    .map((s) => ({ iso: s.depositAt, ms: parseDepositAtMs(s.depositAt) }))
    .filter((t): t is { iso: string; ms: number } => t.ms != null && !!t.iso)
    .sort((a, b) => a.ms - b.ms);

  // Prefer status-aware split: locked OCR → depositAt, terminal OCR → outcomeAt.
  if (lockedTimes.length > 0 && outcomeTimes.length > 0) {
    const depositAt = lockedTimes[0]!.iso;
    const outcomeAt = outcomeTimes[outcomeTimes.length - 1]!.iso;
    return {
      ...merged,
      depositAt,
      outcomeAt: depositAt === outcomeAt ? (merged.outcomeAt ?? null) : outcomeAt,
    };
  }

  const times = [...lockedTimes, ...outcomeTimes].sort((a, b) => a.ms - b.ms);
  if (times.length === 0) return { ...merged, outcomeAt: merged.outcomeAt ?? null };
  const earliest = times[0]!.iso;
  const latest = times[times.length - 1]!.iso;
  if (earliest === latest) {
    return { ...merged, depositAt: earliest, outcomeAt: merged.outcomeAt ?? null };
  }
  return { ...merged, depositAt: earliest, outcomeAt: latest };
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

  return applyLifecycleTimestamps(slips, dest);
}

function sortByDepositAtDesc(slips: DedupedDepositSlip[]): DedupedDepositSlip[] {
  return [...slips].sort((a, b) => {
    const aMs = a.depositAt ? Date.parse(a.depositAt) : 0;
    const bMs = b.depositAt ? Date.parse(b.depositAt) : 0;
    if (bMs !== aMs) return bMs - aMs;
    const aFrame = a.sourceFrameIndex ?? Number.MAX_SAFE_INTEGER;
    const bFrame = b.sourceFrameIndex ?? Number.MAX_SAFE_INTEGER;
    return aFrame - bFrame;
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

/**
 * To-the-minute key that accounts for a strict majority of timestamped rows
 * in a same-name cluster, or null when no minute wins.
 */
function findMajorityMinuteKey(
  slips: readonly ParsedDepositSlipDraft[],
): string | null {
  const keys = slips
    .map((s) => toMinuteTimestampKey(s.depositAt))
    .filter((k): k is string => k != null);
  if (keys.length === 0) return null;
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const majorityThreshold = keys.length / 2;
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > majorityThreshold && count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

function groupDepositAtRange(
  group: readonly ParsedDepositSlipDraft[],
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of group) {
    const ms = parseDepositAtMs(s.depositAt);
    if (ms == null) continue;
    if (ms < min) min = ms;
    if (ms > max) max = ms;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

/** Gap between two closed time ranges (0 when they overlap). */
function rangeGapMs(
  a: { min: number; max: number },
  b: { min: number; max: number },
): number {
  if (a.min > b.max) return a.min - b.max;
  if (b.min > a.max) return b.min - a.max;
  return 0;
}

/**
 * Split timestamped rows into proximity-connected subgroups. Neighbors join
 * when consecutive gaps and the group's overall span are both ≤ `proximityMs`
 * (diameter-capped single-linkage). Rows without a parseable timestamp are
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
  let groupStartMs = anchored[0]!.ms;
  for (let i = 1; i < anchored.length; i += 1) {
    const next = anchored[i]!;
    if (
      next.ms - prevMs <= proximityMs &&
      next.ms - groupStartMs <= proximityMs
    ) {
      current.push(next.row);
    } else {
      groups.push(current);
      current = [next.row];
      groupStartMs = next.ms;
    }
    prevMs = next.ms;
  }
  groups.push(current);
  return { anchoredGroups: groups, unanchored };
}

/**
 * When one minute dominates a name cluster, fold lone nearby OCR outliers into
 * that majority home. Never absorb a multi-row distant group (second deposit).
 *
 * Status-gated: repeated OCR reads of one underlying slip always report the
 * same status (blue/green/orange come from distinct template text), so an
 * outlier whose status isn't already present in the majority group is a
 * distinct lifecycle event (e.g. a post-loot re-deposit), not a re-read of
 * the majority row — refuse to absorb it. See "known looted-window
 * limitation" in `.cursor/rules/season-5-bank-deposits.mdc`.
 */
function absorbMajorityMinuteOutliers<T extends ParsedDepositSlipDraft>(
  anchoredGroups: T[][],
  majorityKey: string,
  outlierMs: number = DEPOSIT_AT_MAJORITY_OUTLIER_MS,
): T[][] {
  if (anchoredGroups.length <= 1) return anchoredGroups;

  const majorityIdx = anchoredGroups.findIndex((g) =>
    g.some((s) => toMinuteTimestampKey(s.depositAt) === majorityKey),
  );
  if (majorityIdx < 0) return anchoredGroups;

  const majorityGroup = anchoredGroups[majorityIdx]!;
  const majorityRange = groupDepositAtRange(majorityGroup);
  if (!majorityRange) return anchoredGroups;

  const majorityStatuses = new Set(majorityGroup.map((s) => s.status));
  const absorbed: T[] = [...majorityGroup];
  const remaining: T[][] = [];
  for (let i = 0; i < anchoredGroups.length; i += 1) {
    if (i === majorityIdx) continue;
    const group = anchoredGroups[i]!;
    const groupRange = groupDepositAtRange(group);
    const gap =
      groupRange == null
        ? Number.POSITIVE_INFINITY
        : rangeGapMs(majorityRange, groupRange);
    // Only singleton outliers whose status already appears in the majority
    // home — a second oversampled deposit or a status-mismatched lifecycle
    // event stays separate.
    if (
      group.length === 1 &&
      gap <= outlierMs &&
      majorityStatuses.has(group[0]!.status)
    ) {
      absorbed.push(...group);
    } else {
      remaining.push(group);
    }
  }
  return [absorbed, ...remaining];
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
 * Split a same-name proximity group when a locked row is timed *after* a
 * terminal (loot/mature) row — that locked is a re-deposit, not the initiate
 * for the terminal. Keeps valid initiate+loot pairs (locked ≤ terminal)
 * together while peeling post-outcome blues out of the ≤15m diameter merge.
 * Peeled re-deposits stay in one subgroup so multi-frame OCR duplicates of
 * the same re-deposit can still proximity / exact-identity merge.
 */
function splitPostOutcomeRedeposits(
  group: readonly IndexedSlip[],
): IndexedSlip[][] {
  const terminals = group.filter(
    (s) => s.status === "matured" || s.status === "looted",
  );
  if (terminals.length === 0) return [group.slice()];

  let latestTerminalMs = Number.NEGATIVE_INFINITY;
  for (const t of terminals) {
    const ms = parseDepositAtMs(t.depositAt);
    if (ms != null && ms > latestTerminalMs) latestTerminalMs = ms;
  }
  if (!Number.isFinite(latestTerminalMs)) return [group.slice()];

  const primary: IndexedSlip[] = [];
  const redeposits: IndexedSlip[] = [];
  for (const slip of group) {
    if (slip.status === "locked") {
      const ms = parseDepositAtMs(slip.depositAt);
      if (ms != null && ms > latestTerminalMs) {
        redeposits.push(slip);
        continue;
      }
    }
    primary.push(slip);
  }
  if (redeposits.length === 0) return [group.slice()];
  return [primary, redeposits];
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

  // Officer-visible fields already agree — never block on server# / OCR junk.
  if (haveExactDisplayIdentity(group)) {
    const anchored = group.filter(
      (s) => toMinuteTimestampKey(s.depositAt) != null,
    );
    const missingTs = group.filter(
      (s) => toMinuteTimestampKey(s.depositAt) == null,
    );
    if (missingTs.length > 0 && anchored.length > 0) {
      // Keep timestamped survivor(s); clipped-ts twins go to the missing-ts section.
      if (anchored.length === 1) {
        const only = anchored[0]!;
        if (!accum.consumed.has(only.slipId)) {
          accum.output.push(only);
          accum.consumed.add(only.slipId);
        }
      } else {
        emitAutoMerged(accum, anchored, "exact_display_identity", []);
      }
      absorbExactMissingTimestampRows(accum, missingTs);
      return;
    }
    emitAutoMerged(accum, group, "exact_display_identity", []);
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

  // Peel post-loot / post-mature re-deposits out of the ≤15m proximity merge.
  const parts = splitPostOutcomeRedeposits(group);
  if (parts.length > 1) {
    for (const part of parts) {
      if (part.length === 0) continue;
      resolveNameTimestampGroup(accum, part, autoMergeReason);
    }
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
 * Within an exact-normalized-name cluster: nearby (diameter-capped) timestamps
 * merge; a majority-minute home may absorb a lone OCR outlier; distant
 * multi-row deposits split; unanchored rows fold when unambiguous. Singletons
 * are left unconsumed so a later same-minute fuzzy pass can still pair OCR
 * name variants (e.g. gondrong / gondronq).
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

  if (timestamped.length === 1) {
    resolveNameTimestampGroup(
      accum,
      [...timestamped, ...unanchored],
      unanchored.length > 0
        ? "commander_match_missing_timestamp"
        : "same_commander_and_minute_timestamp",
    );
    return;
  }

  let { anchoredGroups } = splitByDepositAtProximity(
    timestamped,
    (s) => s.depositAt,
  );

  // Majority must not swallow a second genuine deposit that was also
  // oversampled — only proximity-split first, then absorb singleton OCR
  // outliers near the majority-minute home.
  const majorityKey = findMajorityMinuteKey(timestamped);
  if (majorityKey) {
    anchoredGroups = absorbMajorityMinuteOutliers(anchoredGroups, majorityKey);
  }

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

  // Prefer exact display-identity absorb into a unique survivor before flagging.
  const stillAmbiguous = absorbExactMissingTimestampRows(accum, unanchored);
  if (stillAmbiguous.length === 0) return;
  if (stillAmbiguous.length >= 1) {
    emitFlagged(
      accum,
      stillAmbiguous,
      "commander_match_missing_timestamp_ambiguous",
    );
  }
}

/**
 * Absorb unanchored rows into the unique timestamped survivor that matches
 * display identity. Returns rows that still cannot be placed.
 */
function absorbExactMissingTimestampRows(
  accum: DedupeAccum,
  unanchored: readonly IndexedSlip[],
): IndexedSlip[] {
  const stillUnanchored: IndexedSlip[] = [];
  for (const row of unanchored) {
    if (accum.consumed.has(row.slipId)) continue;
    const key = depositSlipDisplayIdentityKey(row);
    const exactDests = accum.output.filter(
      (d) =>
        !d.dedupeClusterId &&
        toMinuteTimestampKey(d.depositAt) != null &&
        depositSlipDisplayIdentityKey(d) === key,
    );
    if (exactDests.length !== 1) {
      stillUnanchored.push(row);
      continue;
    }
    const destination = exactDests[0]!;
    const clusterId = `c_${nextSlipId()}`;
    accum.clusters.push({
      clusterId,
      disposition: "auto_merged",
      reason: "redundant_missing_timestamp",
      destinationSlipId: destination.slipId,
      members: [
        { slipId: row.slipId, snapshot: slipSnapshot(row) },
        {
          slipId: destination.slipId,
          snapshot: slipSnapshot(destination),
        },
      ],
    });
    accum.consumed.add(row.slipId);
  }
  return stillUnanchored;
}

/**
 * Collapse locked + matured/looted survivors for the same deposit identity
 * when their OCR timestamps are a plausible single-deposit lifecycle pair.
 */
function mergeLifecycleSurvivors(accum: DedupeAccum): void {
  const byIdentity = new Map<string, IndexedSlip[]>();
  for (const slip of accum.output) {
    // Leave officer-flagged clusters alone.
    if (slip.dedupeClusterId) continue;
    const key = depositSlipDisplayIdentityKey(slip, { includeStatus: false });
    const bucket = byIdentity.get(key);
    if (bucket) bucket.push(slip);
    else byIdentity.set(key, [slip]);
  }

  for (const group of byIdentity.values()) {
    if (group.length < 2) continue;
    const locked = group.filter((s) => s.status === "locked");
    const matured = group.filter((s) => s.status === "matured");
    const looted = group.filter((s) => s.status === "looted");
    if (matured.length > 0 && looted.length > 0) continue;
    // Exactly one locked + one matured *or* looted — never fold a second
    // initiate (rapid re-deposit) into an outcome.
    if (locked.length !== 1) continue;
    if (matured.length + looted.length !== 1) continue;
    const outcomeSlip = (matured.length > 0 ? matured : looted)[0]!;
    const lockedSlip = locked[0]!;
    if (!canLifecycleMergePair(lockedSlip, outcomeSlip)) continue;

    const mergeGroup = [lockedSlip, outcomeSlip];
    const reason =
      matured.length > 0
        ? "lifecycle_locked_to_matured"
        : "lifecycle_locked_to_looted";

    const mergeIds = new Set(mergeGroup.map((s) => s.slipId));
    accum.output = accum.output.filter((s) => !mergeIds.has(s.slipId));
    emitAutoMerged(accum, mergeGroup, reason, []);
  }
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

    // Prefer exact display-identity (incl. status) matches — these are clipped
    // timestamps of an already-parsed deposit, not officer work.
    const stillUnanchored = absorbExactMissingTimestampRows(
      accum,
      leftoverUnanchored,
    );

    const reconciliation = reconcileMissingAnchorRows(
      stillUnanchored.filter((s) => !accum.consumed.has(s.slipId)),
      destinations,
      {
        getName: (s) => s.identity.commanderName,
        isCompatible: (rows) =>
          haveExactDisplayIdentity(rows) ||
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
      const exactMatch = haveExactDisplayIdentity([
        ...anchorlessRows,
        destination,
      ]);
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
        reason: exactMatch
          ? "redundant_missing_timestamp"
          : "commander_match_missing_timestamp",
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

  // Pair locked ↔ matured/looted survivors that share deposit identity but
  // landed in different timestamp proximity groups (lifecycle events).
  mergeLifecycleSurvivors(accum);

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
