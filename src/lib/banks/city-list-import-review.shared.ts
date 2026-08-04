import { resolveBankLifecycleStage } from "@/lib/banks/bank-lifecycle.shared";

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
 * Sentinel coordinates used for manual "Add row" placeholder rows.
 * A real City List bank never sits at the map origin.
 */
export function isCityListPlaceholderCoords(
  coordX: number,
  coordY: number,
): boolean {
  return coordX === 0 && coordY === 0;
}

/**
 * Default game server number for a freshly added manual review row: prefer the
 * **majority** positive server among already parsed review rows (mixed-server
 * imports must not inherit the first row's server for every pad), then fall
 * back to an existing HQ bank's server.
 */
export function defaultPlaceholderGameServerNumber(
  rowServerNumbers: readonly number[],
  existingBankServerNumbers: readonly number[],
): number {
  const counts = new Map<number, number>();
  for (const n of rowServerNumbers) {
    if (n > 0) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let bestServer = 0;
  let bestCount = 0;
  for (const [server, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestServer = server;
    }
  }
  if (bestServer > 0) return bestServer;
  return existingBankServerNumbers.find((n) => n > 0) ?? 0;
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
 * value used for the manual "Add row" button; a real City List bank never
 * sits at the map origin.
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

/** Exact alliance City List identity key: `server:x:y`. */
export function cityListBankCoordKey(
  gameServerNumber: number,
  coordX: number,
  coordY: number,
): string {
  return `${gameServerNumber}:${coordX}:${coordY}`;
}

/**
 * City List tiles are currently held banks. Soft-archive (and true past drop
 * deadlines) set `dropByAt` ≤ now. When such a bank reappears on City List,
 * clear the deadline so it returns to active inventory / drop recommendations.
 *
 * Preserve future officer-planned drop deadlines (`dropByAt` > now).
 */
export function cityListUpsertClearsDropByAt(
  dropByAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (dropByAt == null) return false;
  const ms =
    dropByAt instanceof Date
      ? dropByAt.getTime()
      : Date.parse(String(dropByAt));
  if (Number.isNaN(ms)) return false;
  return ms <= now.getTime();
}

export type CityListImportRowPresence = {
  /** Review rows that match an existing HQ bank by exact server+X+Y. */
  existingCount: number;
  /** Review rows that do not match any HQ bank (will insert). */
  newCount: number;
};

/**
 * Classify reviewed import rows against current HQ banks by exact
 * `server:x:y`. Placeholder (0,0) rows never count as existing.
 */
export function classifyCityListImportRowsAgainstHq(
  rows: readonly {
    gameServerNumber: number;
    coordX: number;
    coordY: number;
  }[],
  existingBanks: readonly {
    gameServerNumber: number;
    coordX: number;
    coordY: number;
  }[],
): CityListImportRowPresence & {
  existingKeys: Set<string>;
  rowExistsInHq: (row: {
    gameServerNumber: number;
    coordX: number;
    coordY: number;
  }) => boolean;
} {
  const existingKeys = new Set(
    existingBanks.map((bank) =>
      cityListBankCoordKey(bank.gameServerNumber, bank.coordX, bank.coordY),
    ),
  );

  const rowExistsInHq = (row: {
    gameServerNumber: number;
    coordX: number;
    coordY: number;
  }): boolean => {
    if (isCityListPlaceholderCoords(row.coordX, row.coordY)) return false;
    return existingKeys.has(
      cityListBankCoordKey(row.gameServerNumber, row.coordX, row.coordY),
    );
  };

  let existingCount = 0;
  let newCount = 0;
  for (const row of rows) {
    if (isCityListPlaceholderCoords(row.coordX, row.coordY)) {
      // Incomplete pads — count as neither until filled.
      continue;
    }
    if (rowExistsInHq(row)) existingCount += 1;
    else newCount += 1;
  }

  return { existingCount, newCount, existingKeys, rowExistsInHq };
}

export type CityListBankCoordIdentity = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
};

export type CityListExtraHqBank = CityListBankCoordIdentity & {
  dropByAt: string | null;
  abandonedAt?: string | null;
};

/**
 * HQ banks not pictured in a complete City List import that are still eligible
 * for archive-missing. Excludes banks already abandoned (explicit or legacy
 * past `dropByAt`).
 */
export function listExtraHqBanksForCityListImport<
  TBank extends CityListExtraHqBank,
>(
  existingBanks: readonly TBank[],
  importedCoordKeys: ReadonlySet<string>,
  now: Date = new Date(),
): TBank[] {
  return existingBanks.filter((bank) => {
    const key = cityListBankCoordKey(
      bank.gameServerNumber,
      bank.coordX,
      bank.coordY,
    );
    if (importedCoordKeys.has(key)) return false;
    return resolveBankLifecycleStage(bank, now) !== "abandoned";
  });
}

export type PartitionedCityListReviewRows<TRow extends CityListBankCoordIdentity> =
  {
    newRows: TRow[];
    existingRows: TRow[];
    placeholderRows: TRow[];
  };

/** Split review rows for UI: placeholders and new banks visible; matched HQ rows cluster. */
export function partitionCityListReviewRows<TRow extends CityListBankCoordIdentity>(
  rows: readonly TRow[],
  rowExistsInHq: (row: TRow) => boolean,
): PartitionedCityListReviewRows<TRow> {
  const newRows: TRow[] = [];
  const existingRows: TRow[] = [];
  const placeholderRows: TRow[] = [];
  for (const row of rows) {
    if (isCityListPlaceholderCoords(row.coordX, row.coordY)) {
      placeholderRows.push(row);
    } else if (rowExistsInHq(row)) {
      existingRows.push(row);
    } else {
      newRows.push(row);
    }
  }
  return { newRows, existingRows, placeholderRows };
}
