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
    getDiscordLinkById: vi.fn(),
    getMemberSeasonHigh: vi.fn(),
    listDiscordLinksForUser: vi.fn(),
    listSeasonVrRows: vi.fn(),
    resolveVrSeasonContext: vi.fn(),
    saveDiscordBotPending: vi.fn(),
    setWeeklyPass: vi.fn(),
    upsertMemberSeasonVr: vi.fn(),
    writeDiscordBotAudit: vi.fn(),
  };
});

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: vi.fn(),
}));

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
  getDiscordLinkById,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  listSeasonVrRows,
  resolveVrSeasonContext,
  saveDiscordBotPending,
  setWeeklyPass,
  upsertMemberSeasonVr,
  writeDiscordBotAudit,
  VrPendingChangedError,
  VrSubmissionChangedError,
  WeeklyPassPendingChangedError,
  WeeklyPassTargetChangedError,
} from "@/lib/vr/repository";
import {
  handleDiscordVrButtonConfirm,
  handleDiscordVrSlash,
  handleDiscordWeeklyPass,
  handleDiscordWeeklyPassCharacterPick,
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

describe("handleDiscordWeeklyPass", () => {
  const weekPending = {
    kind: "weekly_pass_pick_character" as const,
    linkIds: ["link-1"],
    active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([LINK] as never);
    vi.mocked(getDiscordBotPending).mockResolvedValue(null);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    } as never);
    vi.mocked(setWeeklyPass).mockResolvedValue(true);
    vi.mocked(writeDiscordBotAudit).mockResolvedValue(undefined);
    vi.mocked(saveDiscordBotPending).mockResolvedValue(undefined);
  });

  it("passes discord self identity, target member, and alliance to the writer", async () => {
    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.activated"),
    );
    expect(setWeeklyPass).toHaveBeenCalledWith({
      commanderId: "cmd-1",
      allianceId: "alliance-1",
      ashedMemberId: "member-1",
      active: true,
      source: "self",
      activity: {
        identity: { kind: "discord", discordUserId: "discord-1" },
      },
    });
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("still replies success when the write is a matching no-op", async () => {
    vi.mocked(setWeeklyPass).mockResolvedValue(false);

    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.activated"),
    );
  });

  it("replies notLinked without a writer call for unlinked users", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([] as never);

    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("vr.notLinked"),
    );
    expect(setWeeklyPass).not.toHaveBeenCalled();
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("saves a picker prompt instead of writing when multiple links exist", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      LINK,
      { ...LINK, id: "link-2", ashedMemberId: "member-2" },
    ] as never);

    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickCharacter"),
    );
    expect(result.characterPicker).toHaveLength(2);
    expect(saveDiscordBotPending).toHaveBeenCalledWith(
      "alliance-1",
      "discord-1",
      {
        kind: "weekly_pass_pick_character",
        linkIds: ["link-1", "link-2"],
        active: true,
      },
    );
    expect(setWeeklyPass).not.toHaveBeenCalled();
  });

  it("threads a matching own-alliance pending as optional context", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: weekPending,
    } as never);

    await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: false,
    });

    expect(setWeeklyPass).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          pending: {
            expected: weekPending,
            required: false,
            linkId: "link-1",
          },
        }),
      }),
    );
  });

  it("does not consume foreign-alliance or non-weekly-pass pending", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "other-alliance",
      pending: weekPending,
    } as never);

    await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    const first = vi.mocked(setWeeklyPass).mock.calls[0]![0];
    expect(first.activity.pending).toBeUndefined();

    vi.mocked(setWeeklyPass).mockClear();
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 8000,
        ashedMemberId: "member-1",
        seasonKey: "1",
      },
    } as never);

    await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    const second = vi.mocked(setWeeklyPass).mock.calls[0]![0];
    expect(second.activity.pending).toBeUndefined();
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("maps stale picker races to pickExpired", async () => {
    vi.mocked(setWeeklyPass).mockRejectedValue(
      new WeeklyPassPendingChangedError(),
    );

    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("maps a moved target to commanderNotFound", async () => {
    vi.mocked(setWeeklyPass).mockRejectedValue(
      new WeeklyPassTargetChangedError(),
    );

    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.commanderNotFound"),
    );
  });

  it.each(["en-US", "pt-BR"] as const)(
    "maps activity write failures to localized saveBlocked (%s)",
    async (locale) => {
      vi.mocked(setWeeklyPass).mockRejectedValue(
        new ActivityWriteError({
          eventKey: "member.weekly_pass_updated",
          failureCategory: "unknown",
        }),
      );

      const result = await handleDiscordWeeklyPass({
        allianceId: "alliance-1",
        discordUserId: "discord-1",
        guildId: "guild-1",
        locale,
        active: true,
      });

      expect(result.reply).toBe(
        createDiscordTranslator(locale)("activity.saveBlocked"),
      );
      expect(saveDiscordBotPending).not.toHaveBeenCalled();
    },
  );

  it("replies updateFailed for unrelated writer failures", async () => {
    vi.mocked(setWeeklyPass).mockRejectedValue(new Error("db down"));

    const result = await handleDiscordWeeklyPass({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      guildId: "guild-1",
      locale: "en-US",
      active: true,
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.updateFailed"),
    );
  });
});

describe("handleDiscordWeeklyPassCharacterPick", () => {
  const weekPending = {
    kind: "weekly_pass_pick_character" as const,
    linkIds: ["link-1", "link-2"],
    active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: weekPending,
    } as never);
    vi.mocked(getDiscordLinkById).mockResolvedValue(LINK as never);
    vi.mocked(getCommanderByAshedMemberId).mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    } as never);
    vi.mocked(setWeeklyPass).mockResolvedValue(true);
    vi.mocked(writeDiscordBotAudit).mockResolvedValue(undefined);
    vi.mocked(saveDiscordBotPending).mockResolvedValue(undefined);
  });

  it("confirms a matching picker into a required pending write", async () => {
    const result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-1",
      locale: "en-US",
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.activated"),
    );
    expect(setWeeklyPass).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: "cmd-1",
        allianceId: "alliance-1",
        ashedMemberId: "member-1",
        active: true,
        source: "self",
        activity: {
          identity: { kind: "discord", discordUserId: "discord-1" },
          pending: { expected: weekPending, required: true, linkId: "link-1" },
        },
      }),
    );
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("denies a foreign-alliance pending row as expired", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "other-alliance",
      pending: weekPending,
    } as never);

    const result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-1",
      locale: "en-US",
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );
    expect(setWeeklyPass).not.toHaveBeenCalled();
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("denies when no pending or a non-picker pending exists", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue(null);
    let result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-1",
      locale: "en-US",
    });
    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );

    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-1",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 8000,
        ashedMemberId: "member-1",
        seasonKey: "1",
      },
    } as never);
    result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-1",
      locale: "en-US",
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );
    expect(setWeeklyPass).not.toHaveBeenCalled();
  });

  it("denies a link that fails identity or picker membership", async () => {
    vi.mocked(getDiscordLinkById).mockResolvedValue({
      ...LINK,
      discordUserId: "discord-other",
    } as never);

    const result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-1",
      locale: "en-US",
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );
    expect(setWeeklyPass).not.toHaveBeenCalled();
  });

  it("denies a picked link missing from the pending linkIds", async () => {
    vi.mocked(getDiscordLinkById).mockResolvedValue({
      ...LINK,
      id: "link-9",
    } as never);

    const result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-9",
      locale: "en-US",
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );
    expect(setWeeklyPass).not.toHaveBeenCalled();
  });

  it("keeps the picker when the required consumption loses the race", async () => {
    vi.mocked(setWeeklyPass).mockRejectedValue(
      new WeeklyPassPendingChangedError(),
    );

    const result = await handleDiscordWeeklyPassCharacterPick({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      linkId: "link-1",
      locale: "en-US",
    });

    expect(result.reply).toBe(
      createDiscordTranslator("en-US")("weeklyPass.pickExpired"),
    );
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });
});
