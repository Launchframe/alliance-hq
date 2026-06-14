import { describe, expect, it, vi } from "vitest";

import * as sessionModule from "@/lib/session";

import { sessionHasPermission } from "./context";

describe("sessionHasPermission", () => {
  it("allows legacy sessions without hqUserId until reconnect", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: null,
      allianceId: "a1",
      allianceTag: "LFgo",
      currentAllianceId: null,
      userLabel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      sessionHasPermission("sess-1", "members:write"),
    ).resolves.toBe(true);
  });

  it("denies when permission is null", async () => {
    await expect(sessionHasPermission("sess-1", null)).resolves.toBe(false);
  });
});
