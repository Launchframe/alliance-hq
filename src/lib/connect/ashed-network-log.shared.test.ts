import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAshedNetworkLog,
  formatAshedNetworkLogForBugReport,
  loadAshedNetworkLog,
  recordAshedClientTransaction,
  recordRosterAshedSyncTransaction,
  sanitizeAshedNetworkPath,
  summarizeAshedNetworkLog,
} from "@/lib/connect/ashed-network-log.shared";

describe("ashed-network-log.shared", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const localStorageMock = {
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
      key: () => null,
      length: 0,
    } satisfies Storage;
    vi.stubGlobal("window", { localStorage: localStorageMock });
    vi.stubGlobal("localStorage", localStorageMock);
    clearAshedNetworkLog();
  });

  it("sanitizes paths and drops query strings", () => {
    expect(sanitizeAshedNetworkPath("/api/members?refresh=1&token=abc")).toBe(
      "/api/members",
    );
    expect(
      sanitizeAshedNetworkPath("https://hq.example/api/members?x=1"),
    ).toBe("/api/members");
  });

  it("appends newest-first and summarizes errors", () => {
    recordAshedClientTransaction({
      kind: "ashed_sync",
      path: "/api/members",
      outcome: "ok",
      durationMs: 100,
      labelKey: "roster_sync",
    });
    recordAshedClientTransaction({
      kind: "ashed_sync",
      path: "/api/members",
      outcome: "error",
      code: "ashed_sync_failed",
      durationMs: 200,
      labelKey: "roster_sync",
    });

    const entries = loadAshedNetworkLog();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.outcome).toBe("error");

    const summary = summarizeAshedNetworkLog(entries);
    expect(summary.total).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.p50DurationMs).toBe(100);
  });

  it("formats a sanitized bug-report attachment", () => {
    recordAshedClientTransaction({
      kind: "hq_api",
      method: "GET",
      path: "/api/members?secret=nope",
      outcome: "ok",
      status: 200,
      durationMs: 12,
    });
    const text = formatAshedNetworkLogForBugReport();
    expect(text).toContain("/api/members");
    expect(text).not.toContain("secret=nope");
  });

  it("records roster sync status transitions", () => {
    recordRosterAshedSyncTransaction({ status: "running" });
    recordRosterAshedSyncTransaction({ status: "failed", lastErrorCode: "timeout" });
    recordRosterAshedSyncTransaction({ status: "idle" });

    const entries = loadAshedNetworkLog();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.outcome).toBe("ok");
    expect(entries[1]?.outcome).toBe("error");
    expect(entries[1]?.code).toBe("timeout");
    expect(entries[2]?.outcome).toBe("running");
    expect(entries.every((entry) => entry.labelKey === "roster_sync")).toBe(
      true,
    );
  });
});
