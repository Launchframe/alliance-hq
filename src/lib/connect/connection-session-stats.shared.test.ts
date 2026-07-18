import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAshedConnectionSessionStats,
  incrementAshedRequestCount,
  loadAshedConnectionSessionStats,
  shouldCountAsAshedSessionRequest,
  startAshedConnectionSession,
} from "./connection-session-stats.shared";

function stubLocalStorage() {
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

describe("connection-session-stats.shared", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    clearAshedConnectionSessionStats();
    vi.unstubAllGlobals();
  });

  it("starts a session with zero requests", () => {
    const stats = startAshedConnectionSession("2026-07-18T12:00:00.000Z");
    expect(stats.connectedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(stats.requestCount).toBe(0);
    expect(loadAshedConnectionSessionStats()?.requestCount).toBe(0);
  });

  it("increments request count while a session exists", () => {
    startAshedConnectionSession();
    expect(incrementAshedRequestCount()?.requestCount).toBe(1);
    expect(incrementAshedRequestCount()?.requestCount).toBe(2);
  });

  it("does not increment without an active session", () => {
    expect(incrementAshedRequestCount()).toBeNull();
  });

  it("classifies Ashed-bound API paths", () => {
    expect(shouldCountAsAshedSessionRequest("/api/members")).toBe(true);
    expect(shouldCountAsAshedSessionRequest("/api/auth/connect")).toBe(true);
    expect(shouldCountAsAshedSessionRequest("/api/auth/disconnect")).toBe(
      false,
    );
    expect(shouldCountAsAshedSessionRequest("/api/health/db")).toBe(false);
    expect(shouldCountAsAshedSessionRequest("/dashboard")).toBe(false);
  });
});
