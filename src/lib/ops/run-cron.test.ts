// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const updateSet = vi.fn();
const sendOpsAlert = vi.fn();
const captureException = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({ values: insertValues }),
    update: () => ({
      set: (data: unknown) => {
        updateSet(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }),
  }),
  schema: {
    cronRuns: { id: "id" },
  },
}));

vi.mock("@/lib/ops/alert.server", () => ({
  sendOpsAlert,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "run1",
}));

describe("runCron", () => {
  beforeEach(() => {
    vi.resetModules();
    insertValues.mockReset().mockResolvedValue(undefined);
    updateSet.mockReset();
    sendOpsAlert.mockReset().mockResolvedValue({ sent: true, eventId: "e1" });
    captureException.mockReset();
  });

  it("persists success with processed count", async () => {
    const { runCron } = await import("./run-cron");
    const res = await runCron("test-cron", async () => ({ processed: 3 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, processed: 3 });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", processed: 3 }),
    );
  });

  it("persists failure, captures Sentry, and alerts", async () => {
    const { runCron } = await import("./run-cron");
    const res = await runCron("test-cron", async () => {
      throw new Error("user@example.com exploded");
    });
    expect(res.status).toBe(500);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failure",
        errorMessage: expect.stringContaining("[redacted-email]"),
      }),
    );
    expect(captureException).toHaveBeenCalledOnce();
    expect(sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "cron:test-cron:failure",
        severity: "error",
      }),
    );
  });
});
