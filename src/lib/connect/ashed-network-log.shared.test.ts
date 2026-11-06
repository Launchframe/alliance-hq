import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAshedNetworkLog,
  formatAshedNetworkLogForBugReport,
  loadAshedNetworkLog,
  recordAshedClientTransaction,
  recordAshedObservedRequest,
  recordDataManagementDatesTransaction,
  recordDataManagementScoresTransaction,
  recordRosterAshedSyncTransaction,
  recordSettingsTeamRosterSyncTransaction,
  recordTrainsRosterSyncTransaction,
  recordVsMatchupImportTransaction,
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

  it("keeps the newest lines when the bug-report attachment is truncated", () => {
    recordAshedClientTransaction({
      kind: "hq_api",
      path: "/api/old",
      outcome: "ok",
      at: "2026-01-01T00:00:00.000Z",
    });
    recordAshedClientTransaction({
      kind: "hq_api",
      path: "/api/new",
      outcome: "error",
      status: 500,
      at: "2026-01-02T00:00:00.000Z",
    });
    const text = formatAshedNetworkLogForBugReport(loadAshedNetworkLog(), 180);
    expect(text).toContain("/api/new");
    expect(text).toContain("…(truncated)");
    expect(text).not.toContain("/api/old");
  });

  it("records observed request status and duration without throwing on quota", () => {
    const ok = recordAshedObservedRequest({
      url: "/api/members?token=secret",
      durationMs: 42.2,
      responseStatus: 200,
    });
    const failed = recordAshedObservedRequest({
      url: "/api/discord/setup/ashed",
      durationMs: 10,
      responseStatus: 503,
    });
    expect(ok).toMatchObject({
      kind: "hq_api",
      path: "/api/members",
      outcome: "ok",
      status: 200,
      durationMs: 42,
    });
    expect(failed).toMatchObject({
      kind: "ashed_op",
      path: "/api/discord/setup/ashed",
      outcome: "error",
      status: 503,
      code: "503",
    });

    const storage = window.localStorage;
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      recordAshedObservedRequest({
        url: "/api/members",
        durationMs: 1,
        responseStatus: 200,
      }),
    ).not.toThrow();
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

  it("records VS matchup import transitions", () => {
    recordVsMatchupImportTransaction({ status: "running" });
    recordVsMatchupImportTransaction({ status: "idle" });
    const entries = loadAshedNetworkLog();
    expect(entries[0]?.labelKey).toBe("vs_import");
    expect(entries[0]?.path).toBe("/api/vs-performance/matchup/import");
    expect(entries[0]?.outcome).toBe("ok");
  });

  it("records data-management and leftover roster sync surfaces", () => {
    recordDataManagementDatesTransaction({ status: "idle" });
    recordDataManagementScoresTransaction({ status: "failed", lastErrorCode: "dm_scores_failed" });
    recordTrainsRosterSyncTransaction({ status: "running" });
    recordSettingsTeamRosterSyncTransaction({ status: "idle" });
    recordDataManagementDatesTransaction({ status: "cancelled" });

    const entries = loadAshedNetworkLog();
    expect(entries.map((entry) => entry.labelKey)).toEqual([
      "dm_dates",
      "settings_team_roster_sync",
      "trains_roster_sync",
      "dm_scores",
      "dm_dates",
    ]);
    expect(entries[0]?.outcome).toBe("cancelled");
    expect(entries[3]?.outcome).toBe("error");
    expect(entries[3]?.code).toBe("dm_scores_failed");
  });
});
