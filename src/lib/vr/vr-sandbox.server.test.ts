import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
  }),
  schema: {
    alliances: {
      id: "id",
      vrSandboxEnabled: "vrSandboxEnabled",
      vrSandboxSeasonKey: "vrSandboxSeasonKey",
    },
  },
}));

import { loadVrSandboxSettings } from "@/lib/vr/vr-sandbox.server";

describe("loadVrSandboxSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([
      { enabled: 1, seasonKey: "sandbox:abc123" },
    ]);
  });

  it("returns seasonKey for alliance admins", async () => {
    const settings = await loadVrSandboxSettings("alliance-1", true);
    expect(settings).toEqual({
      enabled: true,
      seasonKey: "sandbox:abc123",
      canManage: true,
    });
  });

  it("omits seasonKey for read-only viewers", async () => {
    const settings = await loadVrSandboxSettings("alliance-1", false);
    expect(settings).toEqual({
      enabled: true,
      seasonKey: null,
      canManage: false,
    });
  });
});
