// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const insertValues = vi.fn();
const emailPlatformMaintainers = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
    insert: () => ({
      values: insertValues,
    }),
  }),
  schema: {
    opsEvents: {
      id: "id",
      fingerprint: "fingerprint",
      createdAt: "createdAt",
    },
  },
}));

vi.mock("@/lib/ops/platform-maintainer-alert.server", () => ({
  emailPlatformMaintainers,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "evt1",
}));

describe("sendOpsAlert", () => {
  beforeEach(() => {
    vi.resetModules();
    selectLimit.mockReset();
    insertValues.mockReset();
    emailPlatformMaintainers.mockReset();
    delete process.env.E2E_TEST;
    delete process.env.DISCORD_OPS_WEBHOOK_URL;
    selectLimit.mockResolvedValue([]);
    insertValues.mockResolvedValue(undefined);
    emailPlatformMaintainers.mockResolvedValue({
      sent: false,
      recipientCount: 0,
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  it("persists ops_event even when channels skipped for E2E", async () => {
    process.env.E2E_TEST = "true";
    const { sendOpsAlert } = await import("./alert.server");
    const result = await sendOpsAlert({
      severity: "error",
      source: "test",
      title: "Test",
      body: "user@example.com failed uid 12345678901234",
    });
    expect(result.eventId).toBe("evt1");
    expect(insertValues).toHaveBeenCalledOnce();
    const data = insertValues.mock.calls[0][0];
    expect(data.body).not.toContain("user@example.com");
    expect(data.body).not.toContain("12345678901234");
    expect(data.channelStatus.skippedE2E).toBe(true);
  });

  it("scrubs PII from persisted fields", async () => {
    process.env.E2E_TEST = "true";
    const { sendOpsAlert } = await import("./alert.server");
    await sendOpsAlert({
      severity: "error",
      source: "sentry/user@example.com",
      title: "Failure for 12345678901234",
      body: "same user@example.com",
      fingerprint: "alert:user@example.com",
    });
    const data = insertValues.mock.calls[0][0];
    expect(data.source).toBe("sentry/[redacted-email]");
    expect(data.title).toContain("[redacted-uid]");
    expect(data.body).toBe("same [redacted-email]");
    expect(data.fingerprint).toBe("alert:[redacted-email]");
  });

  it("posts Discord webhook with scrubbed content", async () => {
    process.env.DISCORD_OPS_WEBHOOK_URL = "https://discord.example/webhook";
    emailPlatformMaintainers.mockResolvedValue({
      sent: true,
      recipientCount: 1,
    });
    const { sendOpsAlert } = await import("./alert.server");
    await sendOpsAlert({
      severity: "page",
      source: "test",
      title: "Failed user@example.com",
      body: "body",
    });
    const discordBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(discordBody.content).toContain("@here");
    expect(discordBody.content).toContain("[redacted-email]");
    expect(discordBody.content).not.toContain("user@example.com");
  });

  it("skips outbound when fingerprint is duplicate", async () => {
    process.env.DISCORD_OPS_WEBHOOK_URL = "https://discord.example/webhook";
    selectLimit.mockResolvedValue([{ id: "existing" }]);
    const { sendOpsAlert } = await import("./alert.server");
    await sendOpsAlert({
      severity: "error",
      source: "test",
      title: "Dup",
      body: "body",
      fingerprint: "same-fp",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(emailPlatformMaintainers).not.toHaveBeenCalled();
    const data = insertValues.mock.calls[0][0];
    expect(data.channelStatus.skippedDuplicate).toBe(true);
  });
});
