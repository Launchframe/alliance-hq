import { expect, it } from "vitest";
import { CalendarError, calendarOAuthFailureCode, calendarRecoveryMessage } from "./types.shared";

it.each([
  ["stale", "stale"], ["expired", "stale"], ["reconnect", "status.reconnect"], ["uncertain", "status.uncertain"],
  ["busy", "busy"], ["account_change", "accountChange"], ["offline_access_required", "offlineAccessRequired"],
  ["invalid_identity", "identityFailed"], ["missing_scope", "calendarPermissionRequired"],
])("maps %s independently of the HTTP status", (code, key) => {
  expect(calendarRecoveryMessage({ code }, 409)).toBe(key);
  expect(calendarRecoveryMessage({ code }, 400)).toBe(key);
});
it("maps unknown responses safely and never accepts raw provider messages", () => {
  expect(calendarRecoveryMessage({ error: "PRIVATE_TOKEN", code: "PRIVATE_CODE" }, 400)).toBe("failed");
  expect(calendarRecoveryMessage(null, 409)).toBe("stale");
  expect(calendarRecoveryMessage({ code: "toString" }, 400)).toBe("failed");
  expect(calendarOAuthFailureCode(new CalendarError("PRIVATE_TOKEN"))).toBe("failed");
  expect(calendarOAuthFailureCode(new Error("PRIVATE_TOKEN"))).toBe("failed");
});
