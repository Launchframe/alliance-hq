import { describe, expect, it, vi, beforeEach } from "vitest";

import { createDiscordTranslator } from "@/lib/discord/i18n";

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
}));

vi.mock("@/lib/vr/web-vr-audit.server", () => ({
  auditWebVrCommand: vi.fn(),
}));

vi.mock("@/lib/vr/load-progress-chart", () => ({
  loadVrProgressChartPayload: vi.fn().mockResolvedValue({
    seasonKey: "1",
    vrUpdatesLocked: false,
    series: [],
  }),
}));

vi.mock("@/lib/vr/repository", () => ({
  countSeasonReporters: vi.fn(),
  getCommanderByAshedMemberId: vi.fn().mockResolvedValue({
    commanderId: "cmd-1",
    weeklyPassActive: false,
  }),
  getHqVrPending: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listMemberSeasonVrEvents: vi.fn().mockResolvedValue([]),
  listSeasonVrRows: vi.fn(),
  resolveVrSeasonContext: vi.fn().mockResolvedValue({
    seasonKey: "1",
    isPostSeason: false,
    vrUpdatesLocked: false,
    priorSeason: null,
    vrSandboxActive: false,
  }),
  saveHqVrPending: vi.fn(),
  upsertMemberSeasonVr: vi.fn(),
}));

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import {
  countSeasonReporters,
  getCommanderByAshedMemberId,
  getHqVrPending,
  getMemberSeasonHigh,
  listMemberSeasonVrEvents,
  listSeasonVrRows,
  resolveVrSeasonContext,
  saveHqVrPending,
  upsertMemberSeasonVr,
} from "@/lib/vr/repository";
import { auditWebVrCommand } from "@/lib/vr/web-vr-audit.server";
import { handleWebVrCommand, loadMyVrForUser } from "@/lib/vr/web-vr.server";

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
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    } as never);
    vi.mocked(resolveVrSeasonContext).mockResolvedValue({
      seasonKey: "1",
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: false,
    });
  });

  it("returns member_link_required when not linked", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    const result = await handleWebVrCommand({
      sessionId: "session-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
    });
    expect(result).toEqual({ code: "member_link_required" });
    expect(auditWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: null,
        result: { code: "member_link_required" },
      }),
    );
  });

  it("bumps to season min VR when no season high", async () => {
    const result = await handleWebVrCommand({
      sessionId: "session-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
    });
    expect(result).toMatchObject({ status: "set_vr", newVr: 100 });
    expect(auditWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        ashedMemberId: "member-1",
        result: expect.objectContaining({ status: "set_vr", newVr: 100 }),
      }),
    );
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVr: 100,
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
      sessionId: "session-1",
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

  it("rejects VR updates while the server is in post-season", async () => {
    vi.mocked(resolveVrSeasonContext).mockResolvedValue({
      seasonKey: "4",
      isPostSeason: true,
      vrUpdatesLocked: true,
      priorSeason: "4",
      vrSandboxActive: false,
    });

    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand({
      sessionId: "session-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
    });

    expect(result).toEqual({
      status: "season_locked",
      message: translate("vr.seasonLocked"),
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("reports effective VR including weekly pass in set_vr success message", async () => {
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: true,
    } as never);

    const result = await handleWebVrCommand({
      sessionId: "session-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
      explicitInstituteLevel: 1,
    });

    expect(result).toMatchObject({
      status: "set_vr",
      newVr: 100,
      message: expect.stringMatching(/effective VR 350/),
    });
  });

  it("allows VR updates in sandbox mode during post-season", async () => {
    vi.mocked(resolveVrSeasonContext).mockResolvedValue({
      seasonKey: "sandbox:abc",
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: true,
    });
    vi.mocked(getHqVrPending).mockResolvedValue(null);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(null);
    vi.mocked(countSeasonReporters).mockResolvedValue(0);
    vi.mocked(listSeasonVrRows).mockResolvedValue([]);

    const result = await handleWebVrCommand({
      sessionId: "session-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      locale: "en-US",
      explicitInstituteLevel: 20,
    });

    expect(result).toMatchObject({ status: "set_vr", newVr: 5000 });
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({ seasonKey: "sandbox:abc" }),
    );
  });
});

describe("loadMyVrForUser", () => {
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
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(500);
    vi.mocked(listSeasonVrRows).mockResolvedValue([
      {
        ashedMemberId: "member-1",
        highestBaseVr: 500,
        updatedAt: new Date("2026-06-01T12:00:00Z"),
      },
    ] as never);
    vi.mocked(listMemberSeasonVrEvents).mockResolvedValue([]);
    vi.mocked(resolveVrSeasonContext).mockResolvedValue({
      seasonKey: "4",
      isPostSeason: true,
      vrUpdatesLocked: true,
      priorSeason: "4",
      vrSandboxActive: false,
    });
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    } as never);
  });

  it("returns null when the user has no member link", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    await expect(
      loadMyVrForUser({ allianceId: "alliance-1", hqUserId: "hq-1" }),
    ).resolves.toBeNull();
  });

  it("includes post-season context from the alliance season resolver", async () => {
    const payload = await loadMyVrForUser({
      allianceId: "alliance-1",
      hqUserId: "hq-1",
    });
    expect(payload).toMatchObject({
      seasonKey: "4",
      isPostSeason: true,
      vrUpdatesLocked: true,
      priorSeason: "4",
      seasonMaxVr: 500,
      currentVr: 500,
      effectiveVr: 500,
      weeklyPassBoost: 250,
      instituteLevel: 5,
      commanderName: "Tester",
      weeklyPassActive: false,
    });
  });
});
