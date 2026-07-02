import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionIdMock = vi.fn();
const resolveTeamInviteAccessMock = vi.fn();
const createHqClaimInvitesBulkMock = vi.fn();

vi.mock("@/lib/session", () => ({
  readSessionId: () => readSessionIdMock(),
}));

vi.mock("@/lib/native-alliance/team-invites.server", () => ({
  resolveTeamInviteAccess: (sessionId: string) =>
    resolveTeamInviteAccessMock(sessionId),
  assertInviteRoleAllowed: vi.fn(),
}));

vi.mock("@/lib/native-alliance/invites", () => ({
  createHqClaimInvitesBulk: (input: unknown) =>
    createHqClaimInvitesBulkMock(input),
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
    createHqClaimInvitesBulkMock.mockResolvedValue({
      created: [],
      skipped: [],
    });
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
    expect(createHqClaimInvitesBulkMock).not.toHaveBeenCalled();
  });

  it("scopes bulk creation to the session alliance", async () => {
    const res = await POST(
      jsonRequest({ targetAshedMemberIds: ["m1", "m2"], adminLabel: "Batch A" }),
    );

    expect(res.status).toBe(200);
    expect(createHqClaimInvitesBulkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "alliance-1",
        targetAshedMemberIds: ["m1", "m2"],
        invitedByHqUserId: "officer-1",
        adminLabel: "Batch A",
      }),
    );
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });
});
