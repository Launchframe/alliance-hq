import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import {
  claimOpsAlertFingerprint,
  emailPlatformMaintainers,
  listPlatformMaintainerEmails,
} from "./platform-maintainer-alert.server";

describe("listPlatformMaintainerEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns emails for platform maintainer rows", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { email: "pm@example.com" },
            { email: "other@example.com" },
          ]),
        }),
      }),
    } as never);

    await expect(listPlatformMaintainerEmails()).resolves.toEqual([
      "pm@example.com",
      "other@example.com",
    ]);
  });
});

describe("claimOpsAlertFingerprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the fingerprint is new", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ fingerprint: "send-code-global-cap:prod:2026" }]),
          }),
        }),
      }),
    } as never);

    await expect(
      claimOpsAlertFingerprint("send-code-global-cap:prod:2026"),
    ).resolves.toBe(true);
  });

  it("returns false when the fingerprint already exists", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as never);

    await expect(
      claimOpsAlertFingerprint("send-code-global-cap:prod:2026"),
    ).resolves.toBe(false);
  });
});

describe("emailPlatformMaintainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
  });

  it("skips send when dedupe fingerprint was already claimed", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as never);

    const result = await emailPlatformMaintainers({
      subject: "Test",
      text: "Body",
      html: "<p>Body</p>",
      dedupeFingerprint: "dup-key",
    });

    expect(result.sent).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
