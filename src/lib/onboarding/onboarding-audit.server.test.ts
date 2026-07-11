import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeAuditLog } from "@/lib/bff/audit";

import {
  auditInviteRevoked,
  logMemberLinkSubmitConsole,
} from "./onboarding-audit.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(),
}));

describe("auditInviteRevoked", () => {
  beforeEach(() => {
    vi.mocked(writeAuditLog).mockReset();
  });

  it("writes invite.revoked for invite links against hq_invite", async () => {
    await auditInviteRevoked({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      kind: "invite_link",
      resourceId: "inv_1",
    });

    expect(writeAuditLog).toHaveBeenCalledWith({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      action: "invite.revoked",
      resourceType: "hq_invite",
      resourceId: "inv_1",
      metadata: { kind: "invite_link" },
    });
  });

  it("writes invite.revoked for join codes against hq_alliance_join_code", async () => {
    await auditInviteRevoked({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      kind: "join_code",
      resourceId: "code_1",
    });

    expect(writeAuditLog).toHaveBeenCalledWith({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      action: "invite.revoked",
      resourceType: "hq_alliance_join_code",
      resourceId: "code_1",
      metadata: { kind: "join_code" },
    });
  });

  it("writes invite.revoked for commander claim codes", async () => {
    await auditInviteRevoked({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      kind: "commander_claim",
      resourceId: "claim_1",
    });

    expect(writeAuditLog).toHaveBeenCalledWith({
      sessionId: "sess_1",
      allianceId: "ally_1",
      hqUserId: "user_1",
      action: "invite.revoked",
      resourceType: "hq_alliance_join_code",
      resourceId: "claim_1",
      metadata: { kind: "commander_claim" },
    });
  });
});

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
