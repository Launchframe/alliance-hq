/**
 * Deposit-slip cross-frame dedupe: fuzzy commander + to-the-minute timestamp.
 */

import type { ParsedDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
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

let slipIdCounter = 0;

/** Deterministic-ish provisional ids for tests; unique within a process. */
function nextSlipId(): string {
  slipIdCounter += 1;
  return `slip_${slipIdCounter.toString(36)}`;
}

/** Reset counter between tests. */
export function resetDepositSlipIdCounterForTests(): void {
  slipIdCounter = 0;
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

function hasCoreConflict(slips: readonly ParsedDepositSlipDraft[]): boolean {
  const amounts = slips
    .map((s) => s.amount)
    .filter((a): a is number => a != null);
  const terms = slips
    .map((s) => s.termDays)
    .filter((t): t is NonNullable<typeof t> => t != null);
  return new Set(amounts).size > 1 || new Set(terms).size > 1;
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
 * Auto-merge: same fuzzy commander + same to-the-minute timestamp, compatible cores.
 * Flag: timestamp collision across different commanders, borderline fuzzy names,
 * or strong name+time match with conflicting amount/term.
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
      if (hasCoreConflict(group)) {
        clusters.push({
          clusterId,
          disposition: "flagged",
          reason: "same_commander_timestamp_conflicting_amount_or_term",
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

      const merged = coalesceDepositSlips(group);
      const destinationSlipId = nextSlipId();
      const destination: IndexedSlip = {
        ...merged,
        identity: { ...merged.identity },
        slipId: destinationSlipId,
      };
      clusters.push({
        clusterId,
        disposition: "auto_merged",
        reason: "same_commander_and_minute_timestamp",
        destinationSlipId,
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

  for (const s of withoutTs) {
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

  const autoMergedRemoved = clusters
    .filter((c) => c.disposition === "auto_merged")
    .reduce((sum, c) => {
      // members = sources + destination snapshot
      const sourceCount = Math.max(0, c.members.length - 1);
      return sum + Math.max(0, sourceCount - 1);
    }, 0);

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
