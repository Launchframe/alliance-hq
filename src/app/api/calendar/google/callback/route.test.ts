import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CalendarError } from "@/lib/calendar/types.shared";

const mocks = vi.hoisted(() => ({ finish: vi.fn(), user: vi.fn(), cookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("@/lib/calendar/access.server", () => ({ requireCalendarUser: mocks.user }));
vi.mock("@/lib/calendar/google-oauth.server", () => ({ finishGoogleCalendar: mocks.finish, googleCalendarCookieName: () => "__Host-hq-calendar-oauth" }));
vi.mock("@/lib/calendar/origin.server", () => ({ calendarAppOrigin: () => "https://example.test" }));
import { GET } from "./route";

const state = "a".repeat(43);
beforeEach(() => { vi.clearAllMocks(); mocks.cookie.mockReturnValue({ value: state }); mocks.user.mockResolvedValue({ hqUserId: "owner" }); });
afterEach(() => vi.restoreAllMocks());
it.each(["account_change", "offline_access_required", "invalid_identity", "stale", "missing_scope"])("preserves an allowlisted %s recovery without provider data", async (code) => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.finish.mockRejectedValue(new CalendarError(code, 409));
  const response = await GET(new Request(`https://example.test/api/calendar/google/callback?state=${state}&code=PRIVATE_CODE`));
  const redirect = new URL(response.headers.get("location")!);
  expect(redirect.searchParams.get("calendar")).toBe("failed");
  expect(redirect.searchParams.get("reason")).toBe(code);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(log).toHaveBeenCalledWith("[calendar] Google OAuth callback failed", { code });
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_CODE");
});
it("never reflects or logs raw errors and ignores untrusted provider query text", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.finish.mockRejectedValue(new Error("PRIVATE_PROVIDER_TOKEN"));
  const response = await GET(new Request(`https://example.test/api/calendar/google/callback?state=${state}&code=PRIVATE_CODE&error_description=PRIVATE_TEXT`));
  const location = response.headers.get("location")!;
  expect(new URL(location).searchParams.get("reason")).toBe("failed");
  expect(location).not.toContain("PRIVATE");
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
});
it("requires matching state before contacting the provider", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {}); mocks.cookie.mockReturnValue({ value: "b".repeat(43) });
  const response = await GET(new Request(`https://example.test/api/calendar/google/callback?state=${state}&code=unused`));
  expect(response.headers.get("location")).toContain("calendar=failed"); expect(mocks.finish).not.toHaveBeenCalled();
});
