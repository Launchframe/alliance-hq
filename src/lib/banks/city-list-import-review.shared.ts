/** Clamp mobile stepper index after a review row is removed. */
export function clampReviewIndexAfterRemove(
  currentIndex: number,
  removedIndex: number,
  nextLength: number,
): number {
  if (nextLength <= 0) return 0;
  if (currentIndex > removedIndex) return currentIndex - 1;
  return Math.min(currentIndex, nextLength - 1);
}

/**
 * Sentinel coordinates used for manual "Add row" and captured-count padding.
 * A real City List bank never sits at the map origin.
 */
export function isCityListPlaceholderCoords(
  coordX: number,
  coordY: number,
): boolean {
  return coordX === 0 && coordY === 0;
}

/**
 * Number of placeholder rows to add so the review list matches the "Bank
 * Strongholds captured: N/M" header count when OCR parsed fewer tiles than
 * N (e.g. a tile's coordinate line was fully unreadable and its bank could
 * not be recovered by the parser at all). Returns 0 when the header count
 * is unavailable, non-positive, or already met/exceeded. When `capturedLimit`
 * (M) is present, the pad target is `min(N, M)` so a garbled oversized N
 * cannot flood the review list.
 */
export function missingRowCountForCapturedCount(
  parsedRowCount: number,
  capturedCount: number | null,
  capturedLimit: number | null = null,
): number {
  if (capturedCount == null || capturedCount <= 0) return 0;
  const target =
    capturedLimit != null && capturedLimit > 0
      ? Math.min(capturedCount, capturedLimit)
      : capturedCount;
  return Math.max(0, target - parsedRowCount);
}

/**
 * Default game server number for a freshly added (manual or captured-count
 * padded) review row: reuse the alliance's server from other rows already
 * in the review list, falling back to an existing HQ bank's server.
 */
export function defaultPlaceholderGameServerNumber(
  rowServerNumbers: readonly number[],
  existingBankServerNumbers: readonly number[],
): number {
  return (
    rowServerNumbers.find((n) => n > 0) ??
    existingBankServerNumbers.find((n) => n > 0) ??
    0
  );
}

export type CityListRowFieldName =
  | "level"
  | "gameServerNumber"
  | "coordX"
  | "coordY"
  | "currentDepositValue"
  | "currentDepositCount";

export type CityListRowErrors = Partial<Record<CityListRowFieldName, string>>;

export type CityListReviewRowValidationInput = {
  level: number;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
};

/**
 * Validates one review row's required fields before import. Coordinates at
 * exactly (0, 0) are flagged as unfilled — that's the sentinel placeholder
 * value used for both the manual "Add row" button and captured-count
 * padding, and a real City List bank never sits at the map origin.
 */
export function validateCityListReviewRow(
  row: CityListReviewRowValidationInput,
  requiredMsg: string,
  levelMinMsg: string,
): CityListRowErrors {
  const errors: CityListRowErrors = {};
  if (row.level < 1) errors.level = levelMinMsg;
  if (!row.gameServerNumber || row.gameServerNumber <= 0) {
    errors.gameServerNumber = requiredMsg;
  }
  if (isCityListPlaceholderCoords(row.coordX, row.coordY)) {
    errors.coordX = requiredMsg;
    errors.coordY = requiredMsg;
  }
  return errors;
}

/**
 * Server-side import guard for the same sentinel / required fields the
 * review UI enforces. Returns an English API error string, or null when OK.
 */
export function cityListImportBankIdentityError(
  gameServerNumber: number,
  coordX: number,
  coordY: number,
): string | null {
  if (gameServerNumber <= 0) {
    return "Each bank requires a positive gameServerNumber.";
  }
  if (isCityListPlaceholderCoords(coordX, coordY)) {
    return "Bank coordinates (0, 0) are not allowed; fill in real map coordinates.";
  }
  return null;
}

export function cityListReviewRowsHaveErrors(
  rows: readonly CityListReviewRowValidationInput[],
  requiredMsg: string,
  levelMinMsg: string,
): boolean {
  return rows.some(
    (row) =>
      Object.keys(validateCityListReviewRow(row, requiredMsg, levelMinMsg))
        .length > 0,
  );
}
