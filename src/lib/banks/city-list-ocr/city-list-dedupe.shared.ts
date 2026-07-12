/**
 * Merge City List Bank Stronghold parses across overlapping screenshots.
 * Banks are keyed by exact server + coordinates (unique tile identity).
 */

import type {
  ParsedCityListBank,
  ParsedCityListSnapshot,
} from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import {
  emptyDedupeReport,
  type DedupeCluster,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";

export type MergeCityListParsesResult = {
  snapshot: ParsedCityListSnapshot;
  dedupeReport: DedupeReport;
};

export function cityListBankKey(bank: ParsedCityListBank): string {
  return `${bank.gameServerNumber}:${bank.coordX}:${bank.coordY}`;
}

function bankSnapshot(bank: ParsedCityListBank): Record<string, unknown> {
  return {
    gameServerNumber: bank.gameServerNumber,
    coordX: bank.coordX,
    coordY: bank.coordY,
    level: bank.level,
    crystalGoldValue: bank.crystalGoldValue,
    currentDepositCount: bank.currentDepositCount,
  };
}

function completenessScore(bank: ParsedCityListBank): number {
  let score = 0;
  if (bank.level > 0) score += 1;
  if (bank.crystalGoldValue != null && bank.crystalGoldValue > 0) score += 2;
  if (bank.currentDepositCount != null) score += 2;
  return score;
}

export function coalesceCityListBanks(
  banks: readonly ParsedCityListBank[],
): ParsedCityListBank {
  if (banks.length === 0) {
    throw new Error("coalesceCityListBanks requires at least one bank");
  }
  const ranked = [...banks].sort(
    (a, b) => completenessScore(b) - completenessScore(a),
  );
  const dest: ParsedCityListBank = { ...ranked[0]! };

  for (const bank of ranked.slice(1)) {
    if (dest.currentDepositCount == null && bank.currentDepositCount != null) {
      dest.currentDepositCount = bank.currentDepositCount;
    }
    if (
      (dest.crystalGoldValue == null || dest.crystalGoldValue <= 0) &&
      bank.crystalGoldValue != null &&
      bank.crystalGoldValue > 0
    ) {
      dest.crystalGoldValue = bank.crystalGoldValue;
    }
    if (dest.level <= 0 && bank.level > 0) {
      dest.level = bank.level;
    }
  }

  return dest;
}

function firstNonNullNumber(
  values: Array<number | null | undefined>,
): number | null {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function firstNonNullString(
  values: Array<string | null | undefined>,
): string | null {
  for (const value of values) {
    if (value != null && value !== "") return value;
  }
  return null;
}

/**
 * Collapse overlapping City List screenshots into one snapshot.
 * Duplicate tiles (same server + X/Y) are auto-merged; conflicting extras
 * that somehow share a key are still coalesced (coords are the identity).
 */
export function mergeCityListParses(
  parts: readonly ParsedCityListSnapshot[],
): MergeCityListParsesResult {
  if (parts.length === 0) {
    return {
      snapshot: {
        banks: [],
        totalCrystalGoldDeposited: null,
        capturedCount: null,
        capturedLimit: null,
        capturesRemainingToday: null,
        capturesLimitToday: null,
        serverTime: null,
        isComplete: false,
      },
      dedupeReport: emptyDedupeReport(0),
    };
  }

  const byKey = new Map<string, ParsedCityListBank[]>();
  let inputBankCount = 0;
  for (const part of parts) {
    for (const bank of part.banks) {
      inputBankCount += 1;
      const key = cityListBankKey(bank);
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.push(bank);
      } else {
        byKey.set(key, [bank]);
      }
    }
  }

  const clusters: DedupeCluster[] = [];
  const banks: ParsedCityListBank[] = [];
  let clusterSeq = 0;

  for (const [key, group] of byKey) {
    if (group.length === 1) {
      banks.push(group[0]!);
      continue;
    }

    clusterSeq += 1;
    const clusterId = `bank_${clusterSeq}_${key}`;
    const merged = coalesceCityListBanks(group);
    const destinationSlipId = `dest_${clusterId}`;
    clusters.push({
      clusterId,
      disposition: "auto_merged",
      reason: "same_server_and_coordinates",
      destinationSlipId,
      members: [
        ...group.map((bank, index) => ({
          slipId: `src_${clusterId}_${index}`,
          snapshot: bankSnapshot(bank),
        })),
        {
          slipId: destinationSlipId,
          snapshot: bankSnapshot(merged),
        },
      ],
    });
    banks.push(merged);
  }

  banks.sort((a, b) => {
    if (a.gameServerNumber !== b.gameServerNumber) {
      return a.gameServerNumber - b.gameServerNumber;
    }
    if (a.coordX !== b.coordX) return a.coordX - b.coordX;
    return a.coordY - b.coordY;
  });

  const capturedCount = firstNonNullNumber(
    parts.map((part) => part.capturedCount),
  );
  const snapshot: ParsedCityListSnapshot = {
    banks,
    totalCrystalGoldDeposited: firstNonNullNumber(
      parts.map((part) => part.totalCrystalGoldDeposited),
    ),
    capturedCount,
    capturedLimit: firstNonNullNumber(parts.map((part) => part.capturedLimit)),
    capturesRemainingToday: firstNonNullNumber(
      parts.map((part) => part.capturesRemainingToday),
    ),
    capturesLimitToday: firstNonNullNumber(
      parts.map((part) => part.capturesLimitToday),
    ),
    serverTime: firstNonNullString(parts.map((part) => part.serverTime)),
    isComplete: capturedCount != null && banks.length === capturedCount,
  };

  const autoMergedRemoved = clusters.reduce((sum, cluster) => {
    const sourceCount = Math.max(0, cluster.members.length - 1);
    return sum + Math.max(0, sourceCount - 1);
  }, 0);

  return {
    snapshot,
    dedupeReport: {
      clusters,
      autoMergedCount: autoMergedRemoved,
      flaggedCount: 0,
      inputCount: inputBankCount,
      outputCount: banks.length,
    },
  };
}
