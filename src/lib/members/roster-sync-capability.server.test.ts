import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAshedConnectionForAlliance = vi.fn();
const loadSession = vi.fn();
const resolveAllianceTagForSession = vi.fn();
const resolveAllianceByTag = vi.fn();

vi.mock("@/lib/ashed/credential-share.server", () => ({
  resolveAshedConnectionForAlliance: (...args: unknown[]) =>
    resolveAshedConnectionForAlliance(...args),
}));

vi.mock("@/lib/session", () => ({
  loadSession: (...args: unknown[]) => loadSession(...args),
  getAshedConnection: vi.fn(),
}));

vi.mock("@/lib/settings/alliance-settings-access.server", () => ({
  resolveAllianceTagForSession: (...args: unknown[]) =>
    resolveAllianceTagForSession(...args),
}));

vi.mock("@/lib/alliance/resolve", () => ({
  resolveAllianceByTag: (...args: unknown[]) => resolveAllianceByTag(...args),
}));

import {
  assertOfficerAshedSessionForSync,
  resolveOfficerAshedAllianceId,
} from "@/lib/members/roster-sync-capability.server";

describe("roster-sync-capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assertOfficerAshedSessionForSync resolves delegated connections without session allianceTag", async () => {
    loadSession.mockResolvedValue({
      id: "sess-delegate",
      allianceTag: null,
      currentAllianceId: "hq-1",
    });
    resolveAshedConnectionForAlliance.mockResolvedValue({
      connection: { token: "delegated", appId: "app", originUrl: "https://x" },
      isDelegated: true,
      shareId: "share-1",
    });

    await expect(
      assertOfficerAshedSessionForSync("sess-delegate", "hq-1"),
    ).resolves.toEqual({
      token: "delegated",
      appId: "app",
      originUrl: "https://x",
    });
  });

  it("resolveOfficerAshedAllianceId falls back to membership tag for delegates", async () => {
    loadSession.mockResolvedValue({
      id: "sess-delegate",
      allianceTag: null,
      currentAllianceId: "hq-1",
    });
    resolveAllianceTagForSession.mockResolvedValue("LFgo");
    resolveAshedConnectionForAlliance.mockResolvedValue({
      connection: { token: "delegated", appId: "app", originUrl: "https://x" },
      isDelegated: true,
      shareId: "share-1",
    });
    resolveAllianceByTag.mockResolvedValue({ id: "ashed-1", tag: "LFgo" });

    await expect(resolveOfficerAshedAllianceId("sess-delegate")).resolves.toEqual({
      connection: { token: "delegated", appId: "app", originUrl: "https://x" },
      ashedAllianceId: "ashed-1",
    });

    expect(resolveAllianceTagForSession).toHaveBeenCalled();
    expect(resolveAllianceByTag).toHaveBeenCalledWith(
      { token: "delegated", appId: "app", originUrl: "https://x" },
      "LFgo",
    );
  });
});
