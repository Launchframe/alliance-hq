import { describe, expect, it } from "vitest";

import {
  createBugReportCaptureSession,
  signCaptureSession,
  verifyBugReportCaptureSession,
} from "@/lib/feedback/bug-report-capture-session";

describe("bug-report-capture-session", () => {
  it("creates a verifiable session", () => {
    process.env.BUG_REPORT_CAPTURE_SECRET = "test-secret";
    const session = createBugReportCaptureSession("user-1");
    expect(
      verifyBugReportCaptureSession({
        sessionId: session.sessionId,
        userId: session.userId,
        expiresAt: session.expiresAt,
        token: session.token,
      }),
    ).toBe(true);
  });

  it("rejects tampered token", () => {
    process.env.BUG_REPORT_CAPTURE_SECRET = "test-secret";
    const session = createBugReportCaptureSession("user-1");
    expect(
      verifyBugReportCaptureSession({
        sessionId: session.sessionId,
        userId: session.userId,
        expiresAt: session.expiresAt,
        token: "deadbeef",
      }),
    ).toBe(false);
  });

  it("signs deterministically for payload", () => {
    process.env.BUG_REPORT_CAPTURE_SECRET = "test-secret";
    const payload = {
      sessionId: "abc",
      userId: "user-1",
      expiresAt: 1234567890,
    };
    const a = signCaptureSession(payload);
    const b = signCaptureSession(payload);
    expect(a).toBe(b);
  });
});
