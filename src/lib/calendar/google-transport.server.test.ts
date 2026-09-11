import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleCalendarConfiguration, googleCalendarConfigured } from "./google-transport.server";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "e2e-google-client-id");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "e2e-google-client-secret");
  vi.stubEnv("CALENDAR_GOOGLE_TRANSPORT", "mock");
  vi.stubEnv("E2E_TEST", "true");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Google calendar provider boundary", () => {
  it("uses a loopback mock only in the explicit test profile", () => {
    vi.stubEnv("CALENDAR_GOOGLE_TEST_ORIGIN", "http://localhost:5199");
    expect(googleCalendarConfiguration().api).toBe("http://localhost:5199/calendar/v3");
  });
  it.each(["https://example.test", "http://169.254.169.254", "http://localhost:5199/other", "http://user:pass@localhost:5199", "http://localhost:5199?key=value"])("rejects non-loopback or ambiguous overrides: %s", (origin) => {
    vi.stubEnv("CALENDAR_GOOGLE_TEST_ORIGIN", origin);
    expect(googleCalendarConfigured()).toBe(false);
  });
  it("cannot send real credentials to a test provider", () => {
    vi.stubEnv("CALENDAR_GOOGLE_TEST_ORIGIN", "http://localhost:5199");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "non-test-client");
    expect(googleCalendarConfigured()).toBe(false);
  });
  it("does not fall back to live Google when tests lack their mock", () => {
    vi.stubEnv("CALENDAR_GOOGLE_TEST_ORIGIN", "");
    expect(googleCalendarConfigured()).toBe(false);
  });
  it("rejects mock configuration on a deployed server", () => {
    vi.stubEnv("CALENDAR_GOOGLE_TEST_ORIGIN", "http://localhost:5199"); vi.stubEnv("VERCEL", "1");
    expect(googleCalendarConfigured()).toBe(false);
  });
  it("honors the disabled transport profile", () => {
    vi.stubEnv("CALENDAR_GOOGLE_TRANSPORT", "disabled");
    expect(googleCalendarConfigured()).toBe(false);
  });
});
