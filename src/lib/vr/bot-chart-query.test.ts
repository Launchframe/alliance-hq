import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleDiscordWhatIsMyThpChart,
  handleDiscordWhatIsMyVrChart,
  isDiscordThpChartCommand,
  isDiscordVrChartCommand,
} from "@/lib/vr/bot-chart-query";

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: vi.fn(),
}));

vi.mock("@/lib/charts/render-chart-png.server", () => ({
  renderThpHistoryChartPng: vi.fn(),
  renderVrProgressChartPng: vi.fn(),
}));

vi.mock("@/lib/thp/repository", () => ({
  getCommanderIdForMember: vi.fn(),
  getCommanderThpState: vi.fn(),
  listCommanderThpEvents: vi.fn(),
}));

vi.mock("@/lib/vr/load-progress-chart", () => ({
  loadVrProgressChartPayload: vi.fn(),
  listVrProgressChartCommanderCandidates: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getCommanderByAshedMemberId: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listDiscordLinksForUser: vi.fn(),
  resolveSeasonKey: vi.fn(),
  writeDiscordBotAudit: vi.fn(),
}));

import { renderThpHistoryChartPng, renderVrProgressChartPng } from "@/lib/charts/render-chart-png.server";
import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import {
  getCommanderIdForMember,
  getCommanderThpState,
  listCommanderThpEvents,
} from "@/lib/thp/repository";
import { loadVrProgressChartPayload, listVrProgressChartCommanderCandidates } from "@/lib/vr/load-progress-chart";
import {
  getCommanderByAshedMemberId,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  resolveSeasonKey,
} from "@/lib/vr/repository";

const link = {
  id: "link-1",
  allianceId: "a1",
  discordUserId: "d1",
  discordUsername: "player",
  ashedMemberId: "m1",
  memberDisplayName: "Alpha",
  gameUid: "123456789012345",
  linkedAt: new Date(),
  updatedAt: new Date(),
};

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("chart command name helpers", () => {
  it("recognizes VR chart slash names", () => {
    expect(isDiscordVrChartCommand("what-is-my-vr-chart")).toBe(true);
    expect(isDiscordVrChartCommand("what-is-my-vr-progress")).toBe(true);
    expect(isDiscordVrChartCommand("what-is-my-vr")).toBe(false);
  });

  it("recognizes THP chart slash names", () => {
    expect(isDiscordThpChartCommand("what-is-my-thp-chart")).toBe(true);
    expect(isDiscordThpChartCommand("what-is-my-thp-progress")).toBe(true);
    expect(isDiscordThpChartCommand("what-is-my-thp")).toBe(false);
  });
});

describe("handleDiscordWhatIsMyVrChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSeasonKey).mockResolvedValue("1");
    vi.mocked(ensureDiscordMemberLinksFromHq).mockResolvedValue({
      inherited: 0,
      skipped: 0,
    });
    vi.mocked(loadVrProgressChartPayload).mockResolvedValue({
      series: [],
      seasonKey: "1",
      vrUpdatesLocked: false,
    });
    vi.mocked(listVrProgressChartCommanderCandidates).mockResolvedValue([
      { commanderId: "cmd-viewer", memberName: "Alpha" },
      { commanderId: "cmd-other", memberName: "Top" },
    ]);
    vi.mocked(renderVrProgressChartPng).mockResolvedValue(pngBytes);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue(null);
  });

  it("prompts to link when no commanders are linked", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([]);
    const result = await handleDiscordWhatIsMyVrChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.content).toMatch(/link-commander/i);
    }
  });

  it("returns PNG attachment and caption without UID", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link]);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(1000);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-viewer",
      weeklyPassActive: false,
    } as never);
    vi.mocked(loadVrProgressChartPayload).mockResolvedValue({
      series: [
        {
          commanderId: "cmd-viewer",
          ashedMemberId: "m1",
          memberName: "Alpha",
          rank: 5,
          currentBaseVr: 1000,
          isViewer: true,
          events: [{ at: "2026-07-01T00:00:00.000Z", baseVr: 900, instituteLevel: 10 }],
        },
        {
          commanderId: "cmd-other",
          ashedMemberId: "m9",
          memberName: "Top",
          rank: 1,
          currentBaseVr: 5000,
          isViewer: false,
          events: [{ at: "2026-07-01T00:00:00.000Z", baseVr: 4800, instituteLevel: 25 }],
        },
      ],
      seasonKey: "1",
      vrUpdatesLocked: false,
    });

    const result = await handleDiscordWhatIsMyVrChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.ok).toBe(true);
    expect(renderVrProgressChartPng).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleCommanderIds: ["cmd-viewer"],
        showLegend: true,
      }),
    );
    if (result.ok) {
      expect(result.content).toMatch(/Alpha/);
      expect(result.content).not.toMatch(link.gameUid);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.filename).toBe("what-is-my-vr-chart.png");
      expect(result.files[0]!.bytes).toEqual(pngBytes);
    }
  });

  it("lists every linked commander in the caption", async () => {
    const secondLink = {
      ...link,
      id: "link-2",
      ashedMemberId: "m2",
      memberDisplayName: "Bravo",
      gameUid: "987654321098765",
    };
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link, secondLink]);
    vi.mocked(getMemberSeasonHigh).mockImplementation(async (_a, memberId) =>
      memberId === "m1" ? 1000 : 900,
    );
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-viewer",
      weeklyPassActive: false,
    } as never);
    vi.mocked(loadVrProgressChartPayload).mockResolvedValue({
      series: [
        {
          commanderId: "cmd-viewer",
          ashedMemberId: "m1",
          memberName: "Alpha",
          rank: 5,
          currentBaseVr: 1000,
          isViewer: true,
          events: [
            { at: "2026-07-01T00:00:00.000Z", baseVr: 900, instituteLevel: 10 },
          ],
        },
      ],
      seasonKey: "1",
      vrUpdatesLocked: false,
    });

    const result = await handleDiscordWhatIsMyVrChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toMatch(/linked commanders/i);
      expect(result.content).toMatch(/Alpha/);
      expect(result.content).toMatch(/Bravo/);
      expect(result.content).not.toMatch(link.gameUid);
      expect(result.content).not.toMatch(secondLink.gameUid);
    }
  });

  it("includes named alliance commanders on the chart", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link]);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(1000);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-viewer",
      weeklyPassActive: false,
    } as never);
    vi.mocked(loadVrProgressChartPayload).mockResolvedValue({
      series: [
        {
          commanderId: "cmd-viewer",
          ashedMemberId: "m1",
          memberName: "Alpha",
          rank: 5,
          currentBaseVr: 1000,
          isViewer: true,
          events: [{ at: "2026-07-01T00:00:00.000Z", baseVr: 900, instituteLevel: 10 }],
        },
        {
          commanderId: "cmd-other",
          ashedMemberId: "m9",
          memberName: "Top",
          rank: 1,
          currentBaseVr: 5000,
          isViewer: false,
          events: [{ at: "2026-07-01T00:00:00.000Z", baseVr: 4800, instituteLevel: 25 }],
        },
      ],
      seasonKey: "1",
      vrUpdatesLocked: false,
    });

    const result = await handleDiscordWhatIsMyVrChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
      additionalCommanderNames: ["Top"],
    });
    expect(result.ok).toBe(true);
    expect(loadVrProgressChartPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictToCommanderIds: ["cmd-viewer", "cmd-other"],
      }),
    );
    expect(renderVrProgressChartPng).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleCommanderIds: ["cmd-viewer", "cmd-other"],
      }),
    );
  });

  it("rejects unknown commander names", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link]);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-viewer",
      weeklyPassActive: false,
    } as never);
    vi.mocked(listVrProgressChartCommanderCandidates).mockResolvedValue([
      { commanderId: "cmd-viewer", memberName: "Alpha" },
    ]);

    const result = await handleDiscordWhatIsMyVrChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
      additionalCommanderNames: ["Nobody"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.content).toMatch(/Nobody/);
    }
  });
});

describe("handleDiscordWhatIsMyThpChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureDiscordMemberLinksFromHq).mockResolvedValue({
      inherited: 0,
      skipped: 0,
    });
    vi.mocked(listCommanderThpEvents).mockResolvedValue([
      {
        total: 100,
        breakdown: null,
        previousTotal: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        source: "manual",
      },
      {
        total: 110,
        breakdown: null,
        previousTotal: 100,
        createdAt: new Date("2026-07-10T00:00:00.000Z"),
        source: "manual",
      },
    ] as never);
    vi.mocked(renderThpHistoryChartPng).mockResolvedValue(pngBytes);
  });

  it("prompts to link when no commanders are linked", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([]);
    const result = await handleDiscordWhatIsMyThpChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.content).toMatch(/link-commander/i);
    }
  });

  it("returns PNG attachment and caption without UID", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link]);
    vi.mocked(getCommanderIdForMember).mockResolvedValue("cmd-1");
    vi.mocked(getCommanderThpState).mockResolvedValue({
      currentTotalHeroPower: 163_460_435,
      currentThpBreakdown: null,
      thpUpdatedAt: new Date(),
      primaryName: "Alpha",
    });

    const result = await handleDiscordWhatIsMyThpChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toMatch(/Alpha/);
      expect(result.content).toMatch(/163/);
      expect(result.content).not.toMatch(link.gameUid);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.filename).toBe("what-is-my-thp-chart.png");
    }
  });

  it("lists every linked commander in the caption", async () => {
    const secondLink = {
      ...link,
      id: "link-2",
      ashedMemberId: "m2",
      memberDisplayName: "Bravo",
      gameUid: "987654321098765",
    };
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([link, secondLink]);
    vi.mocked(getCommanderIdForMember).mockImplementation(async (_a, memberId) =>
      memberId === "m1" ? "cmd-1" : "cmd-2",
    );
    vi.mocked(getCommanderThpState).mockImplementation(async (commanderId) => ({
      currentTotalHeroPower:
        commanderId === "cmd-1" ? 163_460_435 : 150_000_000,
      currentThpBreakdown: null,
      thpUpdatedAt: new Date(),
      primaryName: commanderId === "cmd-1" ? "Alpha" : "Bravo",
    }));

    const result = await handleDiscordWhatIsMyThpChart({
      allianceId: "a1",
      discordUserId: "d1",
      locale: "en-US",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toMatch(/linked commanders/i);
      expect(result.content).toMatch(/Alpha/);
      expect(result.content).toMatch(/Bravo/);
      expect(result.content).not.toMatch(link.gameUid);
      expect(result.content).not.toMatch(secondLink.gameUid);
    }
  });
});
