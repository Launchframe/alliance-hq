import { describe, expect, it, vi } from "vitest";

import { logMemberLinkSubmitConsole } from "./onboarding-audit.server";

describe("logMemberLinkSubmitConsole", () => {
  it("emits structured JSON without PII fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logMemberLinkSubmitConsole({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      outcome: "roster_miss",
      rosterSource: "local_synced",
      rosterCount: 42,
    });

    expect(info).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(info.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      event: "member_link.submit",
      outcome: "roster_miss",
      allianceId: "ally_1",
      hqUserId: "user_1",
      rosterSource: "local_synced",
      rosterCount: 42,
    });
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("gameUid");
    expect(payload).not.toHaveProperty("reportedName");

    info.mockRestore();
  });

  it("includes ashedMemberId on successful link", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logMemberLinkSubmitConsole({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      outcome: "linked",
      rosterSource: "local_synced",
      rosterCount: 10,
      ashedMemberId: "member_abc",
    });

    const payload = JSON.parse(String(info.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(payload.ashedMemberId).toBe("member_abc");

    info.mockRestore();
  });
});
