import type { ParsedBankInfoFrame } from "@/lib/banks/bank-context-ocr/parse-bank-info-text.shared";
import type { ParsedFavoritesFrame } from "@/lib/banks/bank-context-ocr/parse-favorites-text.shared";

export type DetectedBankContext = {
  gameServerNumber: number | null;
  coordX: number | null;
  coordY: number | null;
  level: number | null;
  owningAllianceTag: string | null;
  bankName: string | null;
  currentDepositValue: number | null;
  depositCapacity: number | null;
  firstCaptureDate: string | null;
  sources: { bankInfo: boolean; favorites: boolean };
};

function isNullableNumber(value: unknown): value is number | null {
  return value == null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableString(value: unknown): value is string | null {
  return value == null || typeof value === "string";
}

/** Type guard for API / rawExtractJson payloads. */
export function isDetectedBankContext(
  value: unknown,
): value is DetectedBankContext {
  if (!value || typeof value !== "object") return false;
  const v = value as DetectedBankContext;
  return (
    isNullableNumber(v.gameServerNumber) &&
    isNullableNumber(v.coordX) &&
    isNullableNumber(v.coordY) &&
    isNullableNumber(v.level) &&
    isNullableString(v.owningAllianceTag) &&
    isNullableString(v.bankName) &&
    isNullableNumber(v.currentDepositValue) &&
    isNullableNumber(v.depositCapacity) &&
    isNullableString(v.firstCaptureDate) &&
    typeof v.sources === "object" &&
    v.sources != null &&
    typeof v.sources.bankInfo === "boolean" &&
    typeof v.sources.favorites === "boolean"
  );
}

/** Read parseSessions.rawExtractJson.detectedBankContext when present. */
export function readDetectedBankContextFromRawExtract(
  rawExtractJson: unknown,
): DetectedBankContext | null {
  if (!rawExtractJson || typeof rawExtractJson !== "object") return null;
  const candidate = (rawExtractJson as { detectedBankContext?: unknown })
    .detectedBankContext;
  return isDetectedBankContext(candidate) ? candidate : null;
}

function isEmptyContext(context: DetectedBankContext): boolean {
  return (
    !context.sources.bankInfo &&
    !context.sources.favorites &&
    context.gameServerNumber == null &&
    context.coordX == null &&
    context.coordY == null &&
    context.level == null &&
    context.owningAllianceTag == null &&
    context.bankName == null &&
    context.currentDepositValue == null &&
    context.depositCapacity == null &&
    context.firstCaptureDate == null
  );
}

function completenessScore(context: DetectedBankContext): number {
  let score = 0;
  if (context.gameServerNumber != null) score += 1;
  if (context.coordX != null && context.coordY != null) score += 3;
  if (context.level != null) score += 1;
  if (context.owningAllianceTag != null) score += 1;
  if (context.bankName != null) score += 1;
  if (context.currentDepositValue != null) score += 1;
  if (context.depositCapacity != null) score += 1;
  if (context.firstCaptureDate != null) score += 1;
  if (context.sources.bankInfo) score += 1;
  if (context.sources.favorites) score += 1;
  return score;
}

/**
 * Merge bank-info and favorites parses from a single frame.
 * Favorites wins for coordinates; bank info supplies deposit/capture fields.
 */
export function mergeBankContext(
  bankInfo: ParsedBankInfoFrame | null,
  favorites: ParsedFavoritesFrame | null,
): DetectedBankContext | null {
  if (bankInfo == null && favorites == null) return null;

  const merged: DetectedBankContext = {
    gameServerNumber:
      favorites?.gameServerNumber ?? bankInfo?.gameServerNumber ?? null,
    coordX: favorites?.coordX ?? null,
    coordY: favorites?.coordY ?? null,
    level: favorites?.level ?? bankInfo?.level ?? null,
    owningAllianceTag:
      bankInfo?.owningAllianceTag ??
      favorites?.owningAllianceTag ??
      null,
    bankName: bankInfo?.bankName ?? favorites?.bankName ?? null,
    currentDepositValue: bankInfo?.currentDepositValue ?? null,
    depositCapacity: bankInfo?.depositCapacity ?? null,
    firstCaptureDate: bankInfo?.firstCaptureDate ?? null,
    sources: {
      bankInfo: bankInfo != null,
      favorites: favorites != null,
    },
  };

  return isEmptyContext(merged) ? null : merged;
}

/**
 * Merge detected bank context across frames, preferring richer non-null fields.
 * Coordinates may come from either source; when both have coords, favorites wins.
 */
export function coalesceDetectedBankContext(
  current: DetectedBankContext | null,
  next: DetectedBankContext | null,
): DetectedBankContext | null {
  if (current == null) return next;
  if (next == null) return current;

  const preferCurrent = completenessScore(current) >= completenessScore(next);
  const primary = preferCurrent ? current : next;
  const secondary = preferCurrent ? next : current;

  const nextHasFavoritesCoords =
    next.sources.favorites && next.coordX != null && next.coordY != null;
  const currentHasFavoritesCoords =
    current.sources.favorites &&
    current.coordX != null &&
    current.coordY != null;

  // Favorites wins for coordinates; prefer the later frame when both have them.
  const coordX = nextHasFavoritesCoords
    ? next.coordX
    : currentHasFavoritesCoords
      ? current.coordX
      : (primary.coordX ?? secondary.coordX);
  const coordY = nextHasFavoritesCoords
    ? next.coordY
    : currentHasFavoritesCoords
      ? current.coordY
      : (primary.coordY ?? secondary.coordY);

  return {
    gameServerNumber:
      primary.gameServerNumber ?? secondary.gameServerNumber,
    coordX,
    coordY,
    level: primary.level ?? secondary.level,
    owningAllianceTag:
      primary.owningAllianceTag ?? secondary.owningAllianceTag,
    bankName: primary.bankName ?? secondary.bankName,
    currentDepositValue:
      primary.currentDepositValue ?? secondary.currentDepositValue,
    depositCapacity: primary.depositCapacity ?? secondary.depositCapacity,
    firstCaptureDate:
      primary.firstCaptureDate ?? secondary.firstCaptureDate,
    sources: {
      bankInfo: current.sources.bankInfo || next.sources.bankInfo,
      favorites: current.sources.favorites || next.sources.favorites,
    },
  };
}
