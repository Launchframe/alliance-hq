import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ROSTER_COLUMN_PREFS_KEY,
  readStoredRosterColumnPrefs,
  resolveRosterColumnVisibility,
  toggleRosterColumnVisibility,
  writeStoredRosterColumnPrefs,
} from "@/lib/members/roster-column-prefs.shared";

describe("resolveRosterColumnVisibility", () => {
  it("merges stored prefs over defaults and keeps name visible", () => {
    const resolved = resolveRosterColumnVisibility(
      { canWrite: true, showSquadEdit: true },
      { thp: false, name: false, vr: true },
    );
    expect(resolved.name).toBe(true);
    expect(resolved.thp).toBe(false);
    expect(resolved.vr).toBe(true);
    expect(resolved.previousNames).toBe(true);
  });

  it("drops squad edit when not allowed", () => {
    const resolved = resolveRosterColumnVisibility(
      { canWrite: false, showSquadEdit: false },
      { squadEdit: true },
    );
    expect(resolved.squadEdit).toBe(false);
  });
});

describe("toggleRosterColumnVisibility", () => {
  it("never toggles the name column off", () => {
    const base = resolveRosterColumnVisibility({
      canWrite: false,
      showSquadEdit: false,
    });
    const next = toggleRosterColumnVisibility(base, "name", false);
    expect(next.name).toBe(true);
  });
});

describe("localStorage column prefs", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredRosterColumnPrefs()).toBeNull();
  });

  it("round-trips visibility prefs", () => {
    const visibility = resolveRosterColumnVisibility({
      canWrite: true,
      showSquadEdit: true,
    });
    writeStoredRosterColumnPrefs({ ...visibility, thp: false });
    expect(readStoredRosterColumnPrefs()).toMatchObject({ thp: false });
  });

  it("ignores invalid stored JSON keys", () => {
    store.set(
      ROSTER_COLUMN_PREFS_KEY,
      JSON.stringify({ thp: "yes", bogus: true, vr: false }),
    );
    expect(readStoredRosterColumnPrefs()).toEqual({ vr: false });
  });
});

describe("localStorage helpers without window", () => {
  it("no-op when window is undefined", () => {
    expect(readStoredRosterColumnPrefs()).toBeNull();
    expect(() =>
      writeStoredRosterColumnPrefs(
        resolveRosterColumnVisibility({
          canWrite: false,
          showSquadEdit: false,
        }),
      ),
    ).not.toThrow();
  });
});
