import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import {
  AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN,
  AUTH_SEND_CODE_IP_MAX_PER_HOUR,
  clientIpFromRequest,
  enforceSendCodeRateLimit,
  SendCodeRateLimitError,
  sendCodeRateLimitsEnabled,
} from "./send-code-rate-limit.server";

vi.mock("@/lib/ops/platform-maintainer-alert.server", () => ({
  countSendCodeAttemptsSince: vi.fn(),
  emailPlatformMaintainers: vi.fn().mockResolvedValue({ sent: true, recipientCount: 1 }),
  pruneOldSendCodeAttempts: vi.fn().mockResolvedValue(undefined),
}));

import * as opsModule from "@/lib/ops/platform-maintainer-alert.server";

describe("clientIpFromRequest", () => {
  it("uses the first x-forwarded-for hop", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(
      clientIpFromRequest(
        new Request("https://example.com", {
          headers: { "x-real-ip": "198.51.100.2" },
        }),
      ),
    ).toBe("198.51.100.2");
    expect(clientIpFromRequest(new Request("https://example.com"))).toBe(
      "unknown",
    );
  });
});

describe("enforceSendCodeRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("E2E_TEST", "");
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("skips limits when E2E_TEST is true", async () => {
    vi.stubEnv("E2E_TEST", "true");
    await expect(enforceSendCodeRateLimit("127.0.0.1")).resolves.toBeUndefined();
    expect(opsModule.countSendCodeAttemptsSince).not.toHaveBeenCalled();
  });

  it("blocks when the global cap is reached and alerts maintainers", async () => {
    vi.mocked(opsModule.countSendCodeAttemptsSince).mockResolvedValue(
      AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN,
    );

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    });
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: selectMock,
    } as never);

    await expect(enforceSendCodeRateLimit("203.0.113.5")).rejects.toMatchObject({
      scope: "global",
    } satisfies Partial<SendCodeRateLimitError>);

    expect(opsModule.emailPlatformMaintainers).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeFingerprint: expect.stringContaining("send-code-global-cap:"),
      }),
    );
  });

  it("blocks when the IP cap is reached", async () => {
    vi.mocked(opsModule.countSendCodeAttemptsSince).mockResolvedValue(0);

    const insertValues = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: AUTH_SEND_CODE_IP_MAX_PER_HOUR }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    } as never);

    await expect(enforceSendCodeRateLimit("203.0.113.5")).rejects.toMatchObject({
      scope: "ip",
    });
    expect(insertValues).not.toHaveBeenCalled();
    expect(opsModule.emailPlatformMaintainers).not.toHaveBeenCalled();
  });

  it("records an attempt when under both caps", async () => {
    vi.mocked(opsModule.countSendCodeAttemptsSince).mockResolvedValue(0);

    const insertValues = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    } as never);

    await enforceSendCodeRateLimit("203.0.113.5");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: "203.0.113.5" }),
    );
  });
});

describe("sendCodeRateLimitsEnabled", () => {
  it("is disabled under E2E_TEST", () => {
    vi.stubEnv("E2E_TEST", "true");
    expect(sendCodeRateLimitsEnabled()).toBe(false);
  });
});
