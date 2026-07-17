import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CITY_LIST_IMPORT_DRAFT_LEGACY_KEY,
  cityListImportDraftKey,
  clearCityListImportDraft,
  readCityListImportDraft,
  writeCityListImportDraft,
  type CityListImportDraft,
} from "@/lib/banks/city-list-import-draft.shared";

const ALLIANCE_A = "alliance-a";
const ALLIANCE_B = "alliance-b";

function draft(
  overrides: Partial<CityListImportDraft> = {},
): CityListImportDraft {
  return {
    version: 1,
    rows: [
      {
        rowKey: "row-1",
        gameServerNumber: 1211,
        coordX: 599,
        coordY: 499,
        level: 3,
        currentDepositValue: 600_000,
        currentDepositCount: 81,
      },
    ],
    snapshot: {
      capturedCount: 6,
      capturedLimit: 8,
      capturesRemainingToday: 2,
      capturesLimitToday: 2,
      serverTime: "2026-07-11T16:57:24.000Z",
      isComplete: true,
    },
    ...overrides,
  };
}

describe("city-list-import-draft", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("sessionStorage", sessionStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a draft with rows and snapshot", () => {
    const d = draft();
    writeCityListImportDraft(ALLIANCE_A, d);
    expect(readCityListImportDraft(ALLIANCE_A)).toEqual(d);
  });

  it("round-trips a draft with a null snapshot", () => {
    const d = draft({ snapshot: null });
    writeCityListImportDraft(ALLIANCE_A, d);
    expect(readCityListImportDraft(ALLIANCE_A)).toEqual(d);
  });

  it("scopes drafts by allianceId", () => {
    const draftA = draft({
      rows: [
        {
          rowKey: "a",
          gameServerNumber: 1,
          coordX: 1,
          coordY: 1,
          level: 1,
          currentDepositValue: null,
          currentDepositCount: null,
        },
      ],
    });
    const draftB = draft({
      rows: [
        {
          rowKey: "b",
          gameServerNumber: 2,
          coordX: 2,
          coordY: 2,
          level: 2,
          currentDepositValue: null,
          currentDepositCount: null,
        },
      ],
    });
    writeCityListImportDraft(ALLIANCE_A, draftA);
    writeCityListImportDraft(ALLIANCE_B, draftB);
    expect(readCityListImportDraft(ALLIANCE_A)).toEqual(draftA);
    expect(readCityListImportDraft(ALLIANCE_B)).toEqual(draftB);
    clearCityListImportDraft(ALLIANCE_A);
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
    expect(readCityListImportDraft(ALLIANCE_B)).toEqual(draftB);
  });

  it("clears the stored draft for that alliance", () => {
    writeCityListImportDraft(ALLIANCE_A, draft());
    clearCityListImportDraft(ALLIANCE_A);
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
    expect(store.has(cityListImportDraftKey(ALLIANCE_A))).toBe(false);
  });

  it("clears the legacy unscoped key on write and clear", () => {
    store.set(CITY_LIST_IMPORT_DRAFT_LEGACY_KEY, JSON.stringify(draft()));
    writeCityListImportDraft(ALLIANCE_A, draft());
    expect(store.has(CITY_LIST_IMPORT_DRAFT_LEGACY_KEY)).toBe(false);

    store.set(CITY_LIST_IMPORT_DRAFT_LEGACY_KEY, JSON.stringify(draft()));
    clearCityListImportDraft(ALLIANCE_A);
    expect(store.has(CITY_LIST_IMPORT_DRAFT_LEGACY_KEY)).toBe(false);
  });

  it("returns null when there is no stored draft", () => {
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
  });

  it("returns null for an empty rows array", () => {
    store.set(
      cityListImportDraftKey(ALLIANCE_A),
      JSON.stringify(draft({ rows: [] })),
    );
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    store.set(cityListImportDraftKey(ALLIANCE_A), "{not json");
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
  });

  it("returns null for a future/unknown draft version (schema bump)", () => {
    store.set(
      cityListImportDraftKey(ALLIANCE_A),
      JSON.stringify({ ...draft(), version: 2 }),
    );
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
  });

  it("returns null when a row is missing a required numeric field", () => {
    const malformed = {
      version: 1,
      rows: [{ rowKey: "row-1", coordX: 599, coordY: 499, level: 3 }],
      snapshot: null,
    };
    store.set(cityListImportDraftKey(ALLIANCE_A), JSON.stringify(malformed));
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
  });

  it("no-ops when window is undefined", () => {
    vi.unstubAllGlobals();
    expect(readCityListImportDraft(ALLIANCE_A)).toBeNull();
    expect(() => writeCityListImportDraft(ALLIANCE_A, draft())).not.toThrow();
    expect(() => clearCityListImportDraft(ALLIANCE_A)).not.toThrow();
  });

  it("no-ops when allianceId is empty", () => {
    expect(readCityListImportDraft("")).toBeNull();
    expect(() => writeCityListImportDraft("", draft())).not.toThrow();
    expect(store.size).toBe(0);
  });
});
