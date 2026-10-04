import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCommanderIdForMember = vi.fn();
const mockGetCommanderMembershipInAlliance = vi.fn();
const mockGetCommanderKillsState = vi.fn();
const mockCountAllianceKillsReporters = vi.fn();
const mockListAllianceCommanderKillsRows = vi.fn();
const mockUpsertCommanderKills = vi.fn();
const mockGetDiscordBotPending = vi.fn();
const mockGetDiscordLinkById = vi.fn();
const mockListDiscordLinksForUser = vi.fn();
const mockSaveDiscordBotPending = vi.fn();
const mockWriteDiscordBotAudit = vi.fn();
const mockEnsureDiscordMemberLinksFromHq = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/kills/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/kills/repository")>();
  return {
    ...original,
    getCommanderIdForMember: (...args: unknown[]) =>
      mockGetCommanderIdForMember(...args),
    getCommanderMembershipInAlliance: (...args: unknown[]) =>
      mockGetCommanderMembershipInAlliance(...args),
    getCommanderKillsState: (...args: unknown[]) =>
      mockGetCommanderKillsState(...args),
    countAllianceKillsReporters: (...args: unknown[]) =>
      mockCountAllianceKillsReporters(...args),
    listAllianceCommanderKillsRows: (...args: unknown[]) =>
      mockListAllianceCommanderKillsRows(...args),
    upsertCommanderKills: (...args: unknown[]) =>
      mockUpsertCommanderKills(...args),
  };
});

vi.mock("@/lib/vr/repository", () => ({
  getDiscordBotPending: (...args: unknown[]) =>
    mockGetDiscordBotPending(...args),
  getDiscordLinkById: (...args: unknown[]) => mockGetDiscordLinkById(...args),
  listDiscordLinksForUser: (...args: unknown[]) =>
    mockListDiscordLinksForUser(...args),
  saveDiscordBotPending: (...args: unknown[]) =>
    mockSaveDiscordBotPending(...args),
  writeDiscordBotAudit: (...args: unknown[]) =>
    mockWriteDiscordBotAudit(...args),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: (...args: unknown[]) =>
    mockEnsureDiscordMemberLinksFromHq(...args),
}));

vi.mock("@/lib/discord/i18n", () => ({
  createDiscordTranslator: () => (key: string) => key,
}));

import { ActivityWriteError } from "@/lib/activity/errors.server";
import { KillsPendingChangedError } from "@/lib/kills/repository";
import {
  handleDiscordKillsButtonConfirm,
  handleDiscordKillsCharacterPick,
  handleDiscordKillsSlash,
} from "@/lib/kills/service";

const ALLIANCE = "alliance-1";
const DISCORD = "discord-1";
const MEMBER = "member-1";
const COMMANDER = "cmd-1";

const link = {
  id: "link-1",
  allianceId: ALLIANCE,
  discordUserId: DISCORD,
  ashedMemberId: MEMBER,
  memberDisplayName: "Cmd Name",
};

const confirmPending = {
  kind: "anomaly_confirm" as const,
  proposedTotal: 150_000,
  commanderId: COMMANDER,
};

const pickPending = {
  kind: "pick_character" as const,
  linkIds: ["link-1"],
  proposedTotal: 90_000,
};

function slashInput(overrides: Record<string, unknown> = {}) {
  return {
    allianceId: ALLIANCE,
    discordUserId: DISCORD,
    locale: "en-US" as const,
    ...overrides,
  };
}

describe("handleDiscordKillsSlash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDiscordLinksForUser.mockResolvedValue([link]);
    mockGetCommanderIdForMember.mockResolvedValue(COMMANDER);
    mockGetDiscordBotPending.mockResolvedValue(null);
    mockGetCommanderKillsState.mockResolvedValue(null);
    mockCountAllianceKillsReporters.mockResolvedValue(0);
    mockListAllianceCommanderKillsRows.mockResolvedValue([]);
    mockUpsertCommanderKills.mockResolvedValue(true);
  });

  it("submits manual totals with discord activity identity and no pending clears", async () => {
    const result = await handleDiscordKillsSlash(
      slashInput({ explicitTotal: 125_000 }),
    );

    expect(result.action.type).toBe("set_kills");
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity).toEqual({
      identity: { kind: "discord", discordUserId: DISCORD },
      method: "manual",
    });
    expect(call.source).toBe("discord");
    expect(mockSaveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("stores an anomaly prompt and performs no mutation", async () => {
    mockCountAllianceKillsReporters.mockResolvedValue(12);
    mockListAllianceCommanderKillsRows.mockResolvedValue([
      { commanderId: "peer-1", total: 100 },
    ]);

    const result = await handleDiscordKillsSlash(
      slashInput({ explicitTotal: 60_000_000 }),
    );

    expect(result.needsConfirmation).toBe(true);
    expect(result.pending).toMatchObject({ kind: "anomaly_confirm" });
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
    expect(mockSaveDiscordBotPending).toHaveBeenCalledWith(
      ALLIANCE,
      DISCORD,
      result.pending,
    );
  });

  it("does not consume a pending row belonging to another alliance", async () => {
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: "other-alliance",
      pending: { ...confirmPending, commanderId: "other-cmd" },
    });

    const result = await handleDiscordKillsSlash(
      slashInput({ explicitTotal: 125_000 }),
    );

    expect(result.action.type).toBe("set_kills");
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity.pending).toBeUndefined();
  });

  it("passes same-alliance pending into the write for optional consumption", async () => {
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: confirmPending,
    });

    const result = await handleDiscordKillsSlash(
      slashInput({ explicitTotal: 125_000 }),
    );

    expect(result.action.type).toBe("set_kills");
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity.pending).toEqual({
      expected: confirmPending,
      required: false,
    });
  });

  it("maps stale pending races to noConfirm without success", async () => {
    mockUpsertCommanderKills.mockRejectedValue(new KillsPendingChangedError());

    const result = await handleDiscordKillsSlash(
      slashInput({ explicitTotal: 125_000 }),
    );

    expect(result).toEqual({
      reply: "errors.noConfirm",
      pending: null,
      action: { type: "none" },
    });
    expect(mockWriteDiscordBotAudit).toHaveBeenCalled();
  });

  it("maps activity write failures to saveBlocked without success", async () => {
    mockUpsertCommanderKills.mockRejectedValue(
      new ActivityWriteError({
        eventKey: "kills.submitted",
        failureCategory: "unknown",
      }),
    );

    const result = await handleDiscordKillsSlash(
      slashInput({ explicitTotal: 125_000 }),
    );

    expect(result).toEqual({
      reply: "activity.saveBlocked",
      pending: null,
      action: { type: "none" },
    });
  });
});

describe("handleDiscordKillsCharacterPick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscordLinkById.mockResolvedValue(link);
    mockGetCommanderIdForMember.mockResolvedValue(COMMANDER);
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: pickPending,
    });
    mockGetCommanderKillsState.mockResolvedValue(null);
    mockCountAllianceKillsReporters.mockResolvedValue(0);
    mockListAllianceCommanderKillsRows.mockResolvedValue([]);
    mockUpsertCommanderKills.mockResolvedValue(true);
  });

  function pick(linkId = "link-1") {
    return handleDiscordKillsCharacterPick({
      allianceId: ALLIANCE,
      discordUserId: DISCORD,
      linkId,
      locale: "en-US",
    });
  }

  it("applies the stored proposedTotal with required pending consumption", async () => {
    const result = await pick();

    expect(result.action.type).toBe("set_kills");
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.total).toBe(90_000);
    expect(call.activity).toEqual({
      identity: { kind: "discord", discordUserId: DISCORD },
      method: "manual",
      pending: { expected: pickPending, required: true },
    });
    expect(mockSaveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("denies picks for links outside the guild alliance", async () => {
    mockGetDiscordLinkById.mockResolvedValue({
      ...link,
      allianceId: "other-alliance",
    });

    const result = await pick();

    expect(result.reply).toBe("errors.nothingPending");
    expect(mockGetCommanderIdForMember).not.toHaveBeenCalled();
  });

  it("denies picks for links owned by another discord user", async () => {
    mockGetDiscordLinkById.mockResolvedValue({
      ...link,
      discordUserId: "someone-else",
    });

    const result = await pick();

    expect(result.reply).toBe("errors.nothingPending");
    expect(mockGetCommanderIdForMember).not.toHaveBeenCalled();
  });

  it("denies picks when the pending row belongs to another alliance", async () => {
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: "other-alliance",
      pending: pickPending,
    });

    const result = await pick();

    expect(result.reply).toBe("errors.nothingPending");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
    expect(mockSaveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("denies picks not listed in the stored pending linkIds", async () => {
    mockGetDiscordLinkById.mockResolvedValue({ ...link, id: "link-2" });
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: { ...pickPending, linkIds: ["link-9"] },
    });

    const result = await pick("link-2");

    expect(result.reply).toBe("errors.nothingPending");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
  });

  it("denies picks when no kills pick pending is stored", async () => {
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: { kind: "pick_character", linkIds: ["link-1"] },
    });

    const result = await pick();

    expect(result.reply).toBe("errors.nothingPending");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
  });
});

describe("handleDiscordKillsButtonConfirm", () => {
  const membership = {
    ashedMemberId: MEMBER,
    memberName: "Cmd Name",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: confirmPending,
    });
    mockGetCommanderMembershipInAlliance.mockResolvedValue(membership);
    mockListDiscordLinksForUser.mockResolvedValue([link]);
    mockGetCommanderKillsState.mockResolvedValue(null);
    mockListAllianceCommanderKillsRows.mockResolvedValue([]);
    mockUpsertCommanderKills.mockResolvedValue(true);
  });

  function confirm(answer: "yes" | "no" = "yes") {
    return handleDiscordKillsButtonConfirm({
      allianceId: ALLIANCE,
      discordUserId: DISCORD,
      answer,
      locale: "en-US",
    });
  }

  it("confirms with required pending consumption and manual method", async () => {
    const result = await confirm("yes");

    expect(result.action.type).toBe("set_kills");
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity).toEqual({
      identity: { kind: "discord", discordUserId: DISCORD },
      method: "manual",
      pending: { expected: confirmPending, required: true },
    });
    expect(call.source).toBe("discord");
    expect(mockSaveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("uses screenshot method and screenshot_ocr source for ocr_confirm pending", async () => {
    const ocrPending = { ...confirmPending, kind: "ocr_confirm" as const };
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: ocrPending,
    });

    const result = await confirm("yes");

    expect(result.action.type).toBe("set_kills");
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity.method).toBe("screenshot");
    expect(call.source).toBe("screenshot_ocr");
  });

  it("rejects confirmation when the pending row belongs to another alliance", async () => {
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: "other-alliance",
      pending: confirmPending,
    });

    const result = await confirm("yes");

    expect(result.reply).toBe("errors.noConfirm");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
  });

  it("rejects confirmation without a live discord link to the commander member", async () => {
    mockListDiscordLinksForUser.mockResolvedValue([
      { ...link, ashedMemberId: "someone-else" },
    ]);

    const result = await confirm("yes");

    expect(result.reply).toBe("errors.noConfirm");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
  });

  it("rejects confirmation when the commander left the alliance", async () => {
    mockGetCommanderMembershipInAlliance.mockResolvedValue(null);

    const result = await confirm("yes");

    expect(result.reply).toBe("errors.noConfirm");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
  });

  it("decline clears pending without mutation", async () => {
    const result = await confirm("no");

    expect(result.action.type).toBe("none");
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
    expect(mockSaveDiscordBotPending).toHaveBeenCalledWith(
      ALLIANCE,
      DISCORD,
      null,
    );
  });
});
