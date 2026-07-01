import { describe, expect, it, vi, beforeEach } from "vitest";

import { createDiscordTranslator } from "@/lib/discord/i18n";

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveMaxBaseVrForAlliance: vi.fn().mockResolvedValue(12750),
}));

vi.mock("@/lib/vr/repository", () => ({
  countSeasonReporters: vi.fn(),
  getHqVrPending: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listMemberSeasonVrEvents: vi.fn(),
  listSeasonVrRows: vi.fn(),
  resolveSeasonKey: vi.fn().mockResolvedValue("1"),
  saveHqVrPending: vi.fn(),
  upsertMemberSeasonVr: vi.fn(),
}));

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import {
  countSeasonReporters,
  getHqVrPending,
  getMemberSeasonHigh,
  listSeasonVrRows,
  saveHqVrPending,
  upsertMemberSeasonVr,
} from "@/lib/vr/repository";
import { handleWebVrCommand } from "@/lib/vr/web-vr.server";

describe("handleWebVrCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue({
      id: "link-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      ashedMemberId: "member-1",
      memberDisplayName: "Tester",
      gameUid: "123456789012",
      linkedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(null);
    vi.mocked(countSeasonReporters).mockResolvedValue(0);
    vi.mocked(listSeasonVrRows).mockResolvedValue([]);
    vi.mocked(getHqVrPending).mockResolvedValue(null);
  });

  it("returns member_link_required when not linked", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    const result = await handleWebVrCommand({
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
    });
    expect(result).toEqual({ code: "member_link_required" });
  });

  it("bumps to 250 when no season high", async () => {
    const result = await handleWebVrCommand({
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
    });
    expect(result).toMatchObject({ status: "set_vr", newVr: 250 });
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVr: 250,
        eventSource: "web",
        hqUserId: "hq-1",
      }),
    );
  });

  it("handles anomaly confirmation", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
    });
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand({
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
      confirm: "yes",
    });
    expect(result).toMatchObject({ status: "set_vr", newVr: 8000 });
    expect(saveHqVrPending).toHaveBeenCalledWith("alliance-1", "hq-1", null);
    expect(upsertMemberSeasonVr).toHaveBeenCalled();
    expect(translate).toBeDefined();
  });
});
