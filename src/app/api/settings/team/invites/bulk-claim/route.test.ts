import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionIdMock = vi.fn();
const resolveTeamInviteAccessMock = vi.fn();
const createAllianceJoinCodeMock = vi.fn();

vi.mock("@/lib/session", () => ({
  readSessionId: () => readSessionIdMock(),
}));

vi.mock("@/lib/native-alliance/team-invites.server", () => ({
  resolveTeamInviteAccess: (sessionId: string) =>
    resolveTeamInviteAccessMock(sessionId),
  assertInviteRoleAllowed: vi.fn(),
}));

vi.mock("@/lib/native-alliance/join-codes", () => ({
  createAllianceJoinCode: (input: unknown) => createAllianceJoinCodeMock(input),
}));

vi.mock("@/lib/native-alliance/invites", () => ({
  CommanderClaimInviteError: class CommanderClaimInviteError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test/api/settings/team/invites/bulk-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const access = {
  ctx: { hqUserId: "officer-1", roleName: "officer", isPlatformMaintainer: false },
  allianceId: "alliance-1",
  assignableRoles: ["member"],
};

describe("POST /api/settings/team/invites/bulk-claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionIdMock.mockResolvedValue("sess-1");
    resolveTeamInviteAccessMock.mockResolvedValue(access);
    createAllianceJoinCodeMock.mockImplementation(
      (input: { targetAshedMemberId?: string }) =>
        Promise.resolve({
          joinCodeId: "jc-1",
          code: `CODE-${input.targetAshedMemberId}`,
          codeHint: "…CODE",
          expiresAt: new Date().toISOString(),
          maxRedemptions: 1,
          roleName: "member",
          targetAshedMemberId: input.targetAshedMemberId ?? null,
          targetCommanderName: "Alpha",
        }),
    );
  });

  it("returns 401 without a session", async () => {
    readSessionIdMock.mockResolvedValue(null);

    const res = await POST(jsonRequest({ targetAshedMemberIds: ["m1"] }));

    expect(res.status).toBe(401);
  });

  it("rejects more than 100 commander ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `m${i}`);

    const res = await POST(jsonRequest({ targetAshedMemberIds: ids }));

    expect(res.status).toBe(400);
    expect(createAllianceJoinCodeMock).not.toHaveBeenCalled();
  });

  it("creates single-use claim join codes for the session alliance", async () => {
    const res = await POST(
      jsonRequest({ targetAshedMemberIds: ["m1", "m2"], adminLabel: "Batch A" }),
    );

    expect(res.status).toBe(200);
    expect(createAllianceJoinCodeMock).toHaveBeenCalledTimes(2);
    expect(createAllianceJoinCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "alliance-1",
        roleName: "member",
        maxRedemptions: 1,
        targetAshedMemberId: "m1",
        createdByHqUserId: "officer-1",
        adminLabel: "Batch A",
      }),
    );
    const body = (await res.json()) as {
      ok?: boolean;
      created?: Array<{ code: string; targetAshedMemberId: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.created).toHaveLength(2);
    expect(body.created?.[0]?.code).toBe("CODE-m1");
  });
});
