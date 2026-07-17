/**
 * sessionStorage draft for the City List "Import banks from screenshots"
 * review step, so an officer's edits survive an accidental modal close
 * (Escape, overlay click) or a page refresh. Only review-step data
 * (parsed banks + snapshot metadata) is persisted — the uploaded screenshot
 * `File`s cannot survive sessionStorage and are not needed once parsed.
 *
 * Keys are scoped by alliance so switching session alliance in the same
 * tab does not restore another alliance's draft.
 */

export const CITY_LIST_IMPORT_DRAFT_KEY_PREFIX =
  "alliance-hq.city-list-import-draft";

/** Unscoped key from the first draft ship — cleared on write/clear. */
export const CITY_LIST_IMPORT_DRAFT_LEGACY_KEY =
  "alliance-hq.city-list-import-draft";

export function cityListImportDraftKey(allianceId: string): string {
  return `${CITY_LIST_IMPORT_DRAFT_KEY_PREFIX}:${allianceId}`;
}

export type CityListImportDraftRow = {
  rowKey: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  currentDepositValue: number | null;
  currentDepositCount: number | null;
};

export type CityListImportDraftSnapshot = {
  capturedCount: number | null;
  capturedLimit: number | null;
  capturesRemainingToday: number | null;
  capturesLimitToday: number | null;
  serverTime: string | null;
  isComplete: boolean;
} | null;

export type CityListImportDraft = {
  version: 1;
  rows: CityListImportDraftRow[];
  snapshot: CityListImportDraftSnapshot;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function parseDraftRow(value: unknown): CityListImportDraftRow | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.rowKey !== "string" ||
    !isFiniteNumber(row.gameServerNumber) ||
    !isFiniteNumber(row.coordX) ||
    !isFiniteNumber(row.coordY) ||
    !isFiniteNumber(row.level) ||
    !isNullableFiniteNumber(row.currentDepositValue) ||
    !isNullableFiniteNumber(row.currentDepositCount)
  ) {
    return null;
  }
  return {
    rowKey: row.rowKey,
    gameServerNumber: row.gameServerNumber,
    coordX: row.coordX,
    coordY: row.coordY,
    level: row.level,
    currentDepositValue: row.currentDepositValue,
    currentDepositCount: row.currentDepositCount,
  };
}

function parseDraftSnapshot(value: unknown): CityListImportDraftSnapshot {
  if (typeof value !== "object" || value === null) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    !isNullableFiniteNumber(snapshot.capturedCount) ||
    !isNullableFiniteNumber(snapshot.capturedLimit) ||
    !isNullableFiniteNumber(snapshot.capturesRemainingToday) ||
    !isNullableFiniteNumber(snapshot.capturesLimitToday) ||
    (snapshot.serverTime !== null && typeof snapshot.serverTime !== "string") ||
    typeof snapshot.isComplete !== "boolean"
  ) {
    return null;
  }
  return {
    capturedCount: snapshot.capturedCount,
    capturedLimit: snapshot.capturedLimit,
    capturesRemainingToday: snapshot.capturesRemainingToday,
    capturesLimitToday: snapshot.capturesLimitToday,
    serverTime: snapshot.serverTime as string | null,
    isComplete: snapshot.isComplete,
  };
}

function parseStoredDraft(raw: string): CityListImportDraft | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CityListImportDraft>;
    if (parsed.version !== 1 || !Array.isArray(parsed.rows)) return null;

    const rows: CityListImportDraftRow[] = [];
    for (const rawRow of parsed.rows) {
      const row = parseDraftRow(rawRow);
      if (!row) return null;
      rows.push(row);
    }
    if (rows.length === 0) return null;

    return {
      version: 1,
      rows,
      snapshot: parseDraftSnapshot(parsed.snapshot),
    };
  } catch {
    return null;
  }
}

function removeLegacyDraftKey(): void {
  try {
    window.sessionStorage.removeItem(CITY_LIST_IMPORT_DRAFT_LEGACY_KEY);
  } catch {
    // ignore
  }
}

/** Returns null when there is no draft, or it fails to parse (schema bump). */
export function readCityListImportDraft(
  allianceId: string,
): CityListImportDraft | null {
  if (typeof window === "undefined" || !allianceId) return null;
  try {
    const raw = window.sessionStorage.getItem(
      cityListImportDraftKey(allianceId),
    );
    if (!raw) return null;
    return parseStoredDraft(raw);
  } catch {
    return null;
  }
}

export function writeCityListImportDraft(
  allianceId: string,
  draft: CityListImportDraft,
): void {
  if (typeof window === "undefined" || !allianceId) return;
  try {
    window.sessionStorage.setItem(
      cityListImportDraftKey(allianceId),
      JSON.stringify(draft),
    );
    removeLegacyDraftKey();
  } catch {
    // Ignore quota / private mode failures — review can still be submitted.
  }
}

export function clearCityListImportDraft(allianceId: string): void {
  if (typeof window === "undefined" || !allianceId) return;
  try {
    window.sessionStorage.removeItem(cityListImportDraftKey(allianceId));
    removeLegacyDraftKey();
  } catch {
    // ignore
  }
}
