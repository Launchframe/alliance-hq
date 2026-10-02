import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDiscordTranslator } from "@/lib/discord/i18n";

vi.mock("@/lib/vr/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/vr/repository")>();
  return {
    ...original,
    countSeasonReporters: vi.fn(),
    getCommanderByAshedMemberId: vi.fn(),
    getDiscordBotPending: vi.fn(),
    getMemberSeasonHigh: vi.fn(),
    listDiscordLinksForUser: vi.fn(),
    listSeasonVrRows: vi.fn(),
    resolveVrSeasonContext: vi.fn(),
    saveDiscordBotPending: vi.fn(),
    upsertMemberSeasonVr: vi.fn(),
    writeDiscordBotAudit: vi.fn(),
  };
});

vi.mock("@/lib/thp/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/thp/repository")>();
  return {
    ...original,
    getCommanderMembershipInAlliance: vi.fn(),
  };
});

import { ActivityWriteError } from "@/lib/activity/errors.server";
import { getCommanderMembershipInAlliance } from "@/lib/thp/repository";
import {
  countSeasonReporters,
  getCommanderByAshedMemberId,
  getDiscordBotPending,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  listSeasonVrRows,
  resolveVrSeasonContext,
  saveDiscordBotPending,
  upsertMemberSeasonVr,
  writeDiscordBotAudit,
  VrPendingChangedError,
  VrSubmissionChangedError,
} from "@/lib/vr/repository";
import {
  handleDiscordVrButtonConfirm,
  handleDiscordVrSlash,
} from "@/lib/vr/service";

const LINK = {
  id: "link-1",
  allianceId: "alliance-1",
  discordUserId: "discord-1",
  ashedMemberId: "member-1",
  memberDisplayName: "Tester",
  vrUpdatesUnlocked: false,
};

function seedUnlockedSeason() {
  vi.mocked(resolveVrSeasonContext).mockResolvedValue({
    seasonKey: "1",
    isPostSeason: false,
    vrUpdatesLocked: false,
    priorSeason: null,
    vrSandboxActive: false,
  });
}

describe("handleDiscordVrSlash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedUnlockedSeason();
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([LINK] as never);
    vi.mocked(getDiscordBotPending).mockResolvedValue(null);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(3000);
    vi.mocked(countSeasonReporters).mockResolvedValue(10);
    vi.mocked(listSeasonVrRows).mockResolvedValue([
      {
        ashedMemberId: "peer-1",
        highestBaseVr: 8000,
        source: "web",
        latest: {},
        memberName: "Peer",
        commanderName: "Peer Cmd",
      },
    ] as never);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    } as never);
    vi.mocked(writeDiscordBotAudit).mockResolvedValue(undefined);
    vi.mocked(saveDiscordBotPending).mockResolvedValue(undefined);
    vi.mocked(upsertMemberSeasonVr).mockResolvedValue(true);
  });

  it("passes discord identity, manual method, and season high to the upsert", async () => {
    const result = await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      explicitInstituteLevel: 16,
    });

    expect(result.action).toMatchObject({ type: "set_vr", vr: 3400 });
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: "cmd-1",
        baseVr: 3400,
        eventSource: "discord",
        discordUserId: "discord-1",
        activity: {
          identity: { kind: "discord", discordUserId: "discord-1" },
          expectedPreviousBaseVr: 3000,
        },
      }),
    );
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("does not consume a foreign alliance pending row", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "other-alliance",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 8000,
        ashedMemberId: "member-1",
        seasonKey: "1",
      },
    } as never);

    await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      explicitInstituteLevel: 16,
    });

    const call = vi.mocked(upsertMemberSeasonVr).mock.calls[0]![0];
    expect(call.activity).toEqual(
      expect.objectContaining({
        identity: { kind: "discord", discordUserId: "discord-1" },
      }),
    );
    expect(call.activity?.pending).toBeUndefined();
  });

  it("maps stale submission races to saveBlocked", async () => {
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(
      new VrSubmissionChangedError(),
    );
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      explicitInstituteLevel: 16,
    });

    expect(result).toEqual({
      reply: translate("activity.saveBlocked"),
      pending: null,
      action: { type: "none" },
    });
  });

  it("maps activity write failures to saveBlocked", async () => {
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(
      new ActivityWriteError({
        eventKey: "vr.submitted",
        failureCategory: "unknown",
      }),
    );
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      explicitInstituteLevel: 16,
    });

    expect(result).toEqual({
      reply: translate("activity.saveBlocked"),
      pending: null,
      action: { type: "none" },
    });
  });

  it("maps required pending CAS failures to noConfirm", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 8000,
        ashedMemberId: "member-1",
        seasonKey: "1",
      },
    } as never);
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(
      new VrPendingChangedError(),
    );
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrSlash({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      explicitInstituteLevel: 16,
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
  });

  it("rethrows unrelated errors", async () => {
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(new Error("db down"));
    await expect(
      handleDiscordVrSlash({
        allianceId: "alliance-1",
        discordUserId: "discord-1",
        locale: "en-US",
        explicitInstituteLevel: 16,
      }),
    ).rejects.toThrow("db down");
  });
});

describe("handleDiscordVrButtonConfirm", () => {
  const pendingData = {
    kind: "anomaly_confirm" as const,
    proposedVr: 8000,
    ashedMemberId: "member-1",
    commanderId: "cmd-1",
    seasonKey: "1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    seedUnlockedSeason();
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([LINK] as never);
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: pendingData,
    } as never);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    } as never);
    vi.mocked(getCommanderMembershipInAlliance).mockResolvedValue({
      ashedMemberId: "member-1",
      memberName: "Cmd",
    } as never);
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(3000);
    vi.mocked(saveDiscordBotPending).mockResolvedValue(undefined);
    vi.mocked(upsertMemberSeasonVr).mockResolvedValue(true);
  });

  it("confirms a matching anomaly prompt into one upsert", async () => {
    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result.action).toMatchObject({ type: "set_vr", vr: 8000 });
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: "cmd-1",
        ashedMemberId: "member-1",
        baseVr: 8000,
        eventSource: "discord",
        discordUserId: "discord-1",
        activity: {
          identity: { kind: "discord", discordUserId: "discord-1" },
          expectedPreviousBaseVr: 3000,
          pending: { expected: pendingData, required: true },
        },
      }),
    );
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("declines with the rejected reply and clears pending", async () => {
    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "no",
    });

    expect(result.reply).toBe(createDiscordTranslator("en-US")("vr.declined"));
    expect(result.action).toEqual({ type: "none" });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
    expect(saveDiscordBotPending).toHaveBeenCalledWith("alliance-1", "discord-1", null);
  });

  it("denies foreign alliance pending without writes", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "other-alliance",
      pending: pendingData,
    } as never);
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("denies a pending bound to a different season", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: { ...pendingData, seasonKey: "2" },
    } as never);
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("denies legacy pending without a season binding", async () => {
    const legacy = { ...pendingData } as Record<string, unknown>;
    delete legacy.seasonKey;
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: legacy,
    } as never);
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("denies when pending member and commander identities conflict", async () => {
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-other",
      weeklyPassActive: false,
    } as never);
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("denies when no live link owns the pending member", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([] as never);
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("resolves commander-only pending via the commander membership", async () => {
    const commanderOnly = {
      kind: "anomaly_confirm" as const,
      proposedVr: 8000,
      commanderId: "cmd-1",
      seasonKey: "1",
    };
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: commanderOnly,
    } as never);
    vi.mocked(getCommanderMembershipInAlliance).mockResolvedValue({
      ashedMemberId: "member-1",
      memberName: "Cmd",
    } as never);

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result.action).toMatchObject({ type: "set_vr" });
    expect(getCommanderMembershipInAlliance).toHaveBeenCalledWith(
      "cmd-1",
      "alliance-1",
    );
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "member-1",
        activity: expect.objectContaining({
          pending: { expected: commanderOnly, required: true },
        }),
      }),
    );
  });

  it("denies when the link does not include the pending member", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      { ...LINK, ashedMemberId: "member-other" },
    ] as never);
    const translate = createDiscordTranslator("en-US");

    const result = await handleDiscordVrButtonConfirm({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      locale: "en-US",
      answer: "yes",
    });

    expect(result).toEqual({
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });
});
