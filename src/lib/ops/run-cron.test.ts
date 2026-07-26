// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const updateSet = vi.fn();
const sendOpsAlert = vi.fn();
const captureException = vi.fn();
const captureMessage = vi.fn();

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
  captureMessage,
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
    captureMessage.mockReset();
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

  it("treats httpStatus >= 500 as failure and alerts", async () => {
    const { runCron } = await import("./run-cron");
    const res = await runCron("video-process-queue", async () => ({
      processed: 0,
      httpStatus: 502,
      error: "Worker dispatch failed",
      jobId: "job-1",
    }));
    expect(res.status).toBe(502);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failure",
        errorClass: "Http502",
        errorMessage: "Worker dispatch failed",
      }),
    );
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "cron:video-process-queue:failure",
      }),
    );
  });

  it("records expected 503 as degraded without alerting", async () => {
    const { runCron } = await import("./run-cron");
    const res = await runCron("vr-daily-report", async () => ({
      processed: 0,
      httpStatus: 503,
      skipFailureAlert: true,
      error: "No report channels configured",
    }));
    expect(res.status).toBe(503);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "degraded",
        errorClass: "ExpectedDegraded",
      }),
    );
    expect(sendOpsAlert).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
