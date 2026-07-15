import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPTURE_REMINDER_SNOOZE_KEY,
  CAPTURE_REMINDER_SNOOZE_MS,
  isSnoozed,
  snoozeItem,
} from "@/lib/battle-plan/capture-reminder-inbox.shared";

function installBrowserGlobals() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return localStorage;
}

describe("capture-reminder snooze", () => {
  beforeEach(() => {
    installBrowserGlobals();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("snooze hides an item until the window expires", () => {
    snoozeItem("item-1");
    expect(isSnoozed("item-1")).toBe(true);

    vi.advanceTimersByTime(CAPTURE_REMINDER_SNOOZE_MS - 1);
    expect(isSnoozed("item-1")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isSnoozed("item-1")).toBe(false);
  });

  it("prunes expired snooze entries on write", () => {
    localStorage.setItem(
      CAPTURE_REMINDER_SNOOZE_KEY,
      JSON.stringify({
        stale: Date.now() - 1,
        active: Date.now() + CAPTURE_REMINDER_SNOOZE_MS,
      }),
    );

    snoozeItem("item-2");

    const map = JSON.parse(
      localStorage.getItem(CAPTURE_REMINDER_SNOOZE_KEY) ?? "{}",
    ) as Record<string, number>;
    expect(map.stale).toBeUndefined();
    expect(map.active).toBeGreaterThan(Date.now());
    expect(map["item-2"]).toBeGreaterThan(Date.now());
  });
});
