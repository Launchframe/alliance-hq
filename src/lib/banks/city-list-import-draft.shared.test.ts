import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CITY_LIST_IMPORT_DRAFT_KEY,
  clearCityListImportDraft,
  readCityListImportDraft,
  writeCityListImportDraft,
  type CityListImportDraft,
} from "@/lib/banks/city-list-import-draft.shared";

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
    writeCityListImportDraft(d);
    expect(readCityListImportDraft()).toEqual(d);
  });

  it("round-trips a draft with a null snapshot", () => {
    const d = draft({ snapshot: null });
    writeCityListImportDraft(d);
    expect(readCityListImportDraft()).toEqual(d);
  });

  it("clears the stored draft", () => {
    writeCityListImportDraft(draft());
    clearCityListImportDraft();
    expect(readCityListImportDraft()).toBeNull();
    expect(store.has(CITY_LIST_IMPORT_DRAFT_KEY)).toBe(false);
  });

  it("returns null when there is no stored draft", () => {
    expect(readCityListImportDraft()).toBeNull();
  });

  it("returns null for an empty rows array", () => {
    store.set(
      CITY_LIST_IMPORT_DRAFT_KEY,
      JSON.stringify(draft({ rows: [] })),
    );
    expect(readCityListImportDraft()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    store.set(CITY_LIST_IMPORT_DRAFT_KEY, "{not json");
    expect(readCityListImportDraft()).toBeNull();
  });

  it("returns null for a future/unknown draft version (schema bump)", () => {
    store.set(
      CITY_LIST_IMPORT_DRAFT_KEY,
      JSON.stringify({ ...draft(), version: 2 }),
    );
    expect(readCityListImportDraft()).toBeNull();
  });

  it("returns null when a row is missing a required numeric field", () => {
    const malformed = {
      version: 1,
      rows: [{ rowKey: "row-1", coordX: 599, coordY: 499, level: 3 }],
      snapshot: null,
    };
    store.set(CITY_LIST_IMPORT_DRAFT_KEY, JSON.stringify(malformed));
    expect(readCityListImportDraft()).toBeNull();
  });

  it("no-ops when window is undefined", () => {
    vi.unstubAllGlobals();
    expect(readCityListImportDraft()).toBeNull();
    expect(() => writeCityListImportDraft(draft())).not.toThrow();
    expect(() => clearCityListImportDraft()).not.toThrow();
  });
});
