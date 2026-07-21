/**
 * Merge City List Bank Stronghold parses across overlapping screenshots.
 * Banks are keyed by exact server + coordinates (unique tile identity).
 */

import {
  CITY_LIST_DEFAULT_LEVEL,
  type ParsedCityListBank,
  type ParsedCityListSnapshot,
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
  // Prefer a recovered Lv.N over the default placeholder (1).
  if (bank.level > 1) score += 2;
  else if (bank.level > 0) score += 1;
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
    // Default level is 1 when OCR misses Lv — prefer a recovered level.
    // Do not escalate between two non-default OCR readings (avoids inventing
    // a higher Lv from a noisier pass).
    if (
      dest.level <= CITY_LIST_DEFAULT_LEVEL &&
      bank.level > dest.level
    ) {
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
 * Same-image dual-pass OCR often drifts X/Y by 1–2 vs the greyscale pass.
 * Match within this tolerance before treating a tile as new.
 */
export const CITY_LIST_OCR_PASS_COORD_TOLERANCE = 2;

/**
 * Skip the green-channel OCR pass when greyscale already recovered every
 * captured tile — halves Tesseract latency on clean screenshots.
 */
export function shouldRunCityListGreenOcrPass(
  primary: Pick<ParsedCityListSnapshot, "isComplete">,
): boolean {
  return !primary.isComplete;
}

/**
 * Index of the nearest primary bank within coord tolerance, or -1.
 * Prefer nearest over first-match so a candidate that sits in two tiles'
 * windows attaches to the closer physical bank.
 */
function findNearestPassBankIndex(
  banks: readonly ParsedCityListBank[],
  candidate: ParsedCityListBank,
  tolerance: number,
): number {
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < banks.length; i += 1) {
    const bank = banks[i]!;
    if (bank.gameServerNumber !== candidate.gameServerNumber) continue;
    const dx = Math.abs(bank.coordX - candidate.coordX);
    const dy = Math.abs(bank.coordY - candidate.coordY);
    if (dx > tolerance || dy > tolerance) continue;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Merge primary + secondary OCR passes from one screenshot.
 *
 * Each pass's own bank list is already in screenshot reading order (top to
 * bottom, left to right — see the zip comment in parse-city-list-text). The
 * pass that recovered more tiles is the more complete read of the grid, so
 * it wins as the position backbone; the other pass only fills in per-tile
 * detail (level/value/deposit count) by nearest-coordinate match. This
 * matters for the exact bug dual-pass exists to fix: when the primary pass
 * drops a whole row, the recovery pass's order — not a game-coordinate sort —
 * is what puts that row back in its correct screen position.
 */
export function mergeCityListOcrPasses(
  primary: ParsedCityListSnapshot,
  secondary: ParsedCityListSnapshot,
): ParsedCityListSnapshot {
  // Equal tile count → primary (greyscale) stays the backbone; only a strictly
  // longer secondary pass flips which list supplies screen positions.
  const [base, overlay] =
    secondary.banks.length > primary.banks.length
      ? [secondary, primary]
      : [primary, secondary];

  const banks: ParsedCityListBank[] = base.banks.map((bank) => ({ ...bank }));

  for (const candidate of overlay.banks) {
    const idx = findNearestPassBankIndex(
      banks,
      candidate,
      CITY_LIST_OCR_PASS_COORD_TOLERANCE,
    );
    if (idx >= 0) {
      const kept = banks[idx]!;
      const merged = coalesceCityListBanks([kept, candidate]);
      banks[idx] = {
        ...merged,
        gameServerNumber: kept.gameServerNumber,
        coordX: kept.coordX,
        coordY: kept.coordY,
      };
    } else {
      banks.push({ ...candidate });
    }
  }

  const capturedCount = firstNonNullNumber([
    primary.capturedCount,
    secondary.capturedCount,
  ]);

  return {
    banks,
    totalCrystalGoldDeposited: firstNonNullNumber([
      primary.totalCrystalGoldDeposited,
      secondary.totalCrystalGoldDeposited,
    ]),
    capturedCount,
    capturedLimit: firstNonNullNumber([
      primary.capturedLimit,
      secondary.capturedLimit,
    ]),
    capturesRemainingToday: firstNonNullNumber([
      primary.capturesRemainingToday,
      secondary.capturesRemainingToday,
    ]),
    capturesLimitToday: firstNonNullNumber([
      primary.capturesLimitToday,
      secondary.capturesLimitToday,
    ]),
    serverTime: firstNonNullString([primary.serverTime, secondary.serverTime]),
    isComplete: capturedCount != null && banks.length === capturedCount,
  };
}

/**
 * Collapse overlapping City List screenshots into one snapshot.
 * Duplicate tiles (same server + X/Y) are auto-merged; conflicting extras
 * that somehow share a key are still coalesced (coords are the identity).
 *
 * Output order follows Map first-encounter order while scanning `parts` in
 * array order: the first time a tile (server + coords) appears fixes its
 * position; duplicates in later screenshots coalesce in place without moving.
 * Tiles seen only in a later part append in the order they are first
 * encountered. Each part's banks are already in that screenshot's reading
 * order (top-to-bottom, left-to-right). This is intentionally NOT a
 * game-coordinate sort — map X/Y do not reliably increase left-to-right/
 * top-to-bottom on screen, so sorting by them would scramble the on-screen
 * grid order officers expect in the review table.
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
