// @vitest-environment node
import { describe, it, expect } from "vitest";

import { scrubAlertText, scrubSentryEvent } from "./scrub";

describe("scrubAlertText", () => {
  it("redacts emails", () => {
    expect(scrubAlertText("failed for user@example.com")).toContain(
      "[redacted-email]",
    );
    expect(scrubAlertText("failed for user@example.com")).not.toContain(
      "user@example.com",
    );
  });

  it("redacts Last War game UIDs", () => {
    const scrubbed = scrubAlertText("member link failed for 12345678901234");
    expect(scrubbed).toContain("[redacted-uid]");
    expect(scrubbed).not.toContain("12345678901234");
  });

  it("redacts session cookies and JWTs", () => {
    const scrubbed = scrubAlertText(
      "cookie alliance_hq_session=abc.def; authjs.session-token=xyz eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    );
    expect(scrubbed).toContain("alliance_hq_session=[redacted]");
    expect(scrubbed).toContain("authjs.session-token=[redacted]");
    expect(scrubbed).toContain("[redacted-jwt]");
    expect(scrubbed).not.toContain("abc.def");
  });

  it("redacts sensitive key-value pairs", () => {
    const scrubbed = scrubAlertText(
      'payload {"game_uid":"12345678901234","authorization":"Bearer abc123"} CRON_SECRET=plain-secret',
    );
    expect(scrubbed).toContain('"game_uid":[redacted]');
    expect(scrubbed).toContain('"authorization":[redacted]');
    expect(scrubbed).toContain("CRON_SECRET=[redacted]");
    expect(scrubbed).not.toContain("12345678901234");
    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).not.toContain("plain-secret");
  });

  it("redacts standalone bearer tokens", () => {
    const scrubbed = scrubAlertText("request failed with Bearer abc.def-123");
    expect(scrubbed).toContain("Bearer [redacted]");
    expect(scrubbed).not.toContain("abc.def-123");
  });
});

describe("scrubSentryEvent", () => {
  it("redacts PII from top-level messages", () => {
    const event = scrubSentryEvent({
      message: "Failed to process user@example.com uid 12345678901234",
    });
    expect(event?.message).toContain("[redacted-email]");
    expect(event?.message).toContain("[redacted-uid]");
    expect(event?.message).not.toContain("user@example.com");
    expect(event?.message).not.toContain("12345678901234");
  });

  it("strips user email and sensitive headers", () => {
    const event = scrubSentryEvent({
      user: { id: "u1", email: "secret@example.com" },
      request: {
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        cookies: { session: "abc" },
      },
      extra: { game_uid: "12345678901234", alliance_id: "keep-me" },
    });
    expect(event?.user?.email).toBeUndefined();
    expect(
      (event?.request?.headers as Record<string, string>).Authorization,
    ).toBe("[redacted]");
    expect((event?.extra as Record<string, unknown>).game_uid).toBe(
      "[redacted]",
    );
    expect((event?.extra as Record<string, unknown>).alliance_id).toBe(
      "keep-me",
    );
  });

  it("redacts PII from exception message values", () => {
    const event = scrubSentryEvent({
      exception: {
        values: [
          { type: "Error", value: "Failed to send to admin@example.com" },
          { type: "TypeError", value: "Cannot read property of null" },
        ],
      },
    });
    expect(event?.exception?.values?.[0].value).toContain("[redacted-email]");
    expect(event?.exception?.values?.[0].value).not.toContain(
      "admin@example.com",
    );
    expect(event?.exception?.values?.[1].value).toBe(
      "Cannot read property of null",
    );
  });
});
