import { describe, expect, it } from "vitest";

import { sanitizeBugReportConsoleText } from "@/lib/feedback/bug-report-log-sanitize";

describe("sanitizeBugReportConsoleText", () => {
  it("redacts JWT-like tokens", () => {
    const input = "auth failed eyJhbGciOiJIUzI1NiIs.abc.def";
    expect(sanitizeBugReportConsoleText(input)).toBe(
      "auth failed [redacted-jwt]",
    );
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization Bearer abc123.secret.token";
    expect(sanitizeBugReportConsoleText(input)).toBe(
      "Authorization Bearer [redacted]",
    );
  });

  it("redacts key=value secrets", () => {
    const input = 'config token="super-secret-value" ready';
    expect(sanitizeBugReportConsoleText(input)).toBe(
      "config token=[redacted] ready",
    );
  });

  it("leaves benign messages unchanged", () => {
    const input = "Video job status updated to complete";
    expect(sanitizeBugReportConsoleText(input)).toBe(input);
  });
});
