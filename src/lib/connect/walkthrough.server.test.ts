import { beforeEach, describe, expect, it, vi } from "vitest";

import { shouldSkipLinkPhoneStep } from "@/lib/connect/walkthrough.server";
import * as linkedDevicesModule from "@/lib/credential-pairing/linked-devices";
import * as sessionModule from "@/lib/session";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    hqUsers: { id: "id", ashedUserId: "ashedUserId" },
  },
}));

describe("shouldSkipLinkPhoneStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for first-time Ashed connect", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-1",
    } as never);
    vi.spyOn(
      sessionModule,
      "resolveEffectiveHqUserIdForSession",
    ).mockResolvedValue("user-1");

    const db = await import("@/lib/db");
    vi.mocked(db.getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ashedUserId: null }]),
          }),
        }),
      }),
    } as never);

    await expect(shouldSkipLinkPhoneStep("sess-1")).resolves.toBe(false);
  });

  it("returns false when reconnecting without a linked device", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-1",
    } as never);
    vi.spyOn(
      sessionModule,
      "resolveEffectiveHqUserIdForSession",
    ).mockResolvedValue("user-1");

    const db = await import("@/lib/db");
    vi.mocked(db.getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ashedUserId: "ashed-1" }]),
          }),
        }),
      }),
    } as never);
    vi.spyOn(linkedDevicesModule, "userHasActiveLinkedDevice").mockResolvedValue(
      false,
    );

    await expect(shouldSkipLinkPhoneStep("sess-1")).resolves.toBe(false);
  });

  it("returns true when reconnecting with an active linked device", async () => {
    vi.spyOn(sessionModule, "loadSession").mockResolvedValue({
      id: "sess-1",
      hqUserId: "user-1",
    } as never);
    vi.spyOn(
      sessionModule,
      "resolveEffectiveHqUserIdForSession",
    ).mockResolvedValue("user-1");

    const db = await import("@/lib/db");
    vi.mocked(db.getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ashedUserId: "ashed-1" }]),
          }),
        }),
      }),
    } as never);
    vi.spyOn(linkedDevicesModule, "userHasActiveLinkedDevice").mockResolvedValue(
      true,
    );

    await expect(shouldSkipLinkPhoneStep("sess-1")).resolves.toBe(true);
  });
});
