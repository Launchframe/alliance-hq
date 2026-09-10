import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(), getAshedConnection: vi.fn(), getAllianceOperatingMode: vi.fn(),
  resolveAllianceByTag: vi.fn(), base44ListMembers: vi.fn(), listAllianceMembers: vi.fn(),
}));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/native-alliance/operating-mode", () => mocks);
vi.mock("@/lib/alliance/resolve", () => mocks);
vi.mock("@/lib/base44/fetch", () => mocks);
vi.mock("@/lib/members/roster.server", () => ({
  listAllianceMembers: mocks.listAllianceMembers,
  allianceMemberRowToAshedMember: (row: { ashedMemberId: string; currentName: string }) => ({ id: row.ashedMemberId, current_name: row.currentName }),
}));

import { loadMembersForApiContext, resolveMembersApiContext } from "./members-api-context";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue({ id: "session", currentAllianceId: "native-alliance" });
  mocks.getAllianceOperatingMode.mockResolvedValue("native");
});

describe("native members API context", () => {
  it("resolves without a tag or credentials and loads only the selected local roster", async () => {
    const context = await resolveMembersApiContext();
    expect(context).not.toBeInstanceOf(NextResponse);
    if (context instanceof NextResponse) throw new Error("Unexpected response");
    mocks.listAllianceMembers.mockResolvedValue([{ ashedMemberId: "local-member", currentName: "Alpha" }]);
    expect(await loadMembersForApiContext(context)).toEqual([{ id: "local-member", current_name: "Alpha" }]);
    expect(mocks.listAllianceMembers).toHaveBeenCalledWith("native-alliance");
    expect(mocks.getAshedConnection).not.toHaveBeenCalled();
    expect(mocks.base44ListMembers).not.toHaveBeenCalled();
    expect(mocks.resolveAllianceByTag).not.toHaveBeenCalled();
  });

  it("keeps Ashed context credential requirements", async () => {
    mocks.requireApiSession.mockResolvedValue({ id: "session", currentAllianceId: "ashed-alliance", allianceTag: "HQ" });
    mocks.getAllianceOperatingMode.mockResolvedValue("ashed");
    mocks.getAshedConnection.mockResolvedValue(null);
    const context = await resolveMembersApiContext();
    expect(context).toBeInstanceOf(NextResponse);
    expect((context as NextResponse).status).toBe(401);
    expect(mocks.listAllianceMembers).not.toHaveBeenCalled();
  });

  it("loads Ashed members only with the context's bound connection and alliance", async () => {
    const connection = { appId: "app", token: "test-token", originUrl: "https://example.test" };
    mocks.base44ListMembers.mockResolvedValue([{ id: "ashed-member", current_name: "Alpha" }]);
    await loadMembersForApiContext({ operatingMode: "ashed", hqAllianceId: "hq", ashedAllianceId: "external", connection });
    expect(mocks.base44ListMembers).toHaveBeenCalledWith(connection, "external");
    expect(mocks.listAllianceMembers).not.toHaveBeenCalled();
  });
});
