import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEMBERS_LIST_FILTERS_KEY,
  membersListHrefFromFilters,
  readStoredMembersListFilters,
  writeStoredMembersListFilters,
} from "@/lib/members/members-list-filters.shared";

describe("membersListHrefFromFilters", () => {
  it("builds href with query params", () => {
    expect(
      membersListHrefFromFilters({ searchInput: "  beta  ", showFormer: true }),
    ).toBe("/members?q=beta&former=1");
  });

  it("omits empty search from href", () => {
    expect(
      membersListHrefFromFilters({ searchInput: "   ", showFormer: false }),
    ).toBe("/members");
  });

  it("defaults to /members when filters are null", () => {
    expect(membersListHrefFromFilters(null)).toBe("/members");
  });
});

describe("sessionStorage filter persistence", () => {
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

  it("returns null when nothing is stored", () => {
    expect(readStoredMembersListFilters()).toBeNull();
  });

  it("round-trips search and former flags", () => {
    writeStoredMembersListFilters({ searchInput: "alpha", showFormer: true });
    expect(readStoredMembersListFilters()).toEqual({
      searchInput: "alpha",
      showFormer: true,
    });
  });

  it("normalizes invalid stored JSON", () => {
    store.set(
      MEMBERS_LIST_FILTERS_KEY,
      JSON.stringify({ searchInput: 42, showFormer: "yes" }),
    );
    expect(readStoredMembersListFilters()).toEqual({
      searchInput: "",
      showFormer: false,
    });
  });
});

describe("sessionStorage helpers without window", () => {
  it("no-op when window is undefined", () => {
    expect(readStoredMembersListFilters()).toBeNull();
    expect(() =>
      writeStoredMembersListFilters({ searchInput: "x", showFormer: false }),
    ).not.toThrow();
  });
});
