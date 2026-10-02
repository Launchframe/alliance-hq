import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCommanderIdForMember = vi.fn();
const mockGetCommanderMembershipInAlliance = vi.fn();
const mockGetCommanderThpState = vi.fn();
const mockCountAllianceThpReporters = vi.fn();
const mockListAllianceCommanderThpRows = vi.fn();
const mockUpsertCommanderThp = vi.fn();
const mockGetDiscordBotPending = vi.fn();
const mockGetDiscordLinkById = vi.fn();
const mockListDiscordLinksForUser = vi.fn();
const mockSaveDiscordBotPending = vi.fn();
const mockWriteDiscordBotAudit = vi.fn();
const mockEnsureDiscordMemberLinksFromHq = vi.fn();
const mockParsePowerDetailsImage = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/thp/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/thp/repository")>();
  return {
    ...original,
    getCommanderIdForMember: (...args: unknown[]) =>
      mockGetCommanderIdForMember(...args),
    getCommanderMembershipInAlliance: (...args: unknown[]) =>
      mockGetCommanderMembershipInAlliance(...args),
    getCommanderThpState: (...args: unknown[]) =>
      mockGetCommanderThpState(...args),
    countAllianceThpReporters: (...args: unknown[]) =>
      mockCountAllianceThpReporters(...args),
    listAllianceCommanderThpRows: (...args: unknown[]) =>
      mockListAllianceCommanderThpRows(...args),
    upsertCommanderThp: (...args: unknown[]) => mockUpsertCommanderThp(...args),
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

vi.mock("@/lib/thp/hero-power-ocr/parse-power-details-image", () => ({
  parsePowerDetailsImage: (...args: unknown[]) =>
    mockParsePowerDetailsImage(...args),
}));

import { ActivityWriteError } from "@/lib/activity/errors.server";
import { ThpPendingChangedError } from "@/lib/thp/repository";
import {
  handleDiscordThpButtonConfirm,
  handleDiscordThpCharacterPick,
  handleDiscordThpSlash,
} from "@/lib/thp/service";

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
  proposedTotal: 150_000_000,
  proposedBreakdown: null,
  commanderId: COMMANDER,
};

function slashInput(overrides: Record<string, unknown> = {}) {
  return {
    allianceId: ALLIANCE,
    discordUserId: DISCORD,
    locale: "en-US" as const,
    ...overrides,
  };
}

describe("handleDiscordThpSlash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDiscordLinksForUser.mockResolvedValue([link]);
    mockGetCommanderIdForMember.mockResolvedValue(COMMANDER);
    mockGetDiscordBotPending.mockResolvedValue(null);
    mockGetCommanderThpState.mockResolvedValue(null);
    mockCountAllianceThpReporters.mockResolvedValue(0);
    mockListAllianceCommanderThpRows.mockResolvedValue([]);
    mockUpsertCommanderThp.mockResolvedValue(true);
  });

  it("submits manual totals with discord activity identity and no pending clears", async () => {
    const result = await handleDiscordThpSlash(
      slashInput({ explicitTotal: 125_000_000 }),
    );

    expect(result.action.type).toBe("set_thp");
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity).toEqual({
      identity: { kind: "discord", discordUserId: DISCORD },
      method: "manual",
    });
    expect(mockSaveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("stores an OCR prompt and performs no mutation", async () => {
    mockParsePowerDetailsImage.mockResolvedValue({
      heroPowerTotal: 150_000_000,
      breakdown: {},
      complete: true,
    });

    const result = await handleDiscordThpSlash(
      slashInput({ screenshotBuffer: Buffer.from("png") }),
    );

    expect(result.needsConfirmation).toBe(true);
    expect(result.pending).toMatchObject({ kind: "ocr_confirm" });
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
    expect(mockSaveDiscordBotPending).toHaveBeenCalledWith(
      ALLIANCE,
      DISCORD,
      result.pending,
    );
  });

  it("does not consume a pending row belonging to another alliance", async () => {
    const foreignPending = {
      kind: "anomaly_confirm" as const,
      proposedTotal: 42_000_000,
      proposedBreakdown: null,
      commanderId: "other-cmd",
    };
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: "other-alliance",
      pending: foreignPending,
    });

    const result = await handleDiscordThpSlash(
      slashInput({ explicitTotal: 125_000_000 }),
    );

    expect(result.action.type).toBe("set_thp");
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity.pending).toBeUndefined();
  });

  it("passes same-alliance pending into the write for optional consumption", async () => {
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: confirmPending,
    });

    const result = await handleDiscordThpSlash(
      slashInput({ explicitTotal: 125_000_000 }),
    );

    expect(result.action.type).toBe("set_thp");
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity.pending).toEqual({
      expected: confirmPending,
      required: false,
    });
  });

  it("maps stale pending races to noConfirm without success", async () => {
    mockUpsertCommanderThp.mockRejectedValue(new ThpPendingChangedError());

    const result = await handleDiscordThpSlash(
      slashInput({ explicitTotal: 125_000_000 }),
    );

    expect(result).toEqual({
      reply: "errors.noConfirm",
      pending: null,
      action: { type: "none" },
    });
    expect(mockWriteDiscordBotAudit).toHaveBeenCalled();
  });

  it("maps activity write failures to saveBlocked without success", async () => {
    mockUpsertCommanderThp.mockRejectedValue(
      new ActivityWriteError({
        eventKey: "thp.submitted",
        failureCategory: "unknown",
      }),
    );

    const result = await handleDiscordThpSlash(
      slashInput({ explicitTotal: 125_000_000 }),
    );

    expect(result).toEqual({
      reply: "activity.saveBlocked",
      pending: null,
      action: { type: "none" },
    });
  });
});

describe("handleDiscordThpCharacterPick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscordLinkById.mockResolvedValue(link);
    mockGetCommanderIdForMember.mockResolvedValue(COMMANDER);
    mockGetDiscordBotPending.mockResolvedValue(null);
    mockGetCommanderThpState.mockResolvedValue(null);
    mockCountAllianceThpReporters.mockResolvedValue(0);
    mockListAllianceCommanderThpRows.mockResolvedValue([]);
  });

  it("denies picks for links outside the guild alliance", async () => {
    mockGetDiscordLinkById.mockResolvedValue({
      ...link,
      allianceId: "other-alliance",
    });

    const result = await handleDiscordThpCharacterPick({
      allianceId: ALLIANCE,
      discordUserId: DISCORD,
      linkId: "link-1",
      locale: "en-US",
    });

    expect(result.reply).toBe("errors.nothingPending");
    expect(mockGetCommanderIdForMember).not.toHaveBeenCalled();
  });
});

describe("handleDiscordThpButtonConfirm", () => {
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
    mockGetCommanderThpState.mockResolvedValue(null);
    mockListAllianceCommanderThpRows.mockResolvedValue([]);
    mockUpsertCommanderThp.mockResolvedValue(true);
  });

  function confirm(answer: "yes" | "no" = "yes") {
    return handleDiscordThpButtonConfirm({
      allianceId: ALLIANCE,
      discordUserId: DISCORD,
      answer,
      locale: "en-US",
    });
  }

  it("confirms with required pending consumption and manual method", async () => {
    const result = await confirm("yes");

    expect(result.action.type).toBe("set_thp");
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity).toEqual({
      identity: { kind: "discord", discordUserId: DISCORD },
      method: "manual",
      pending: { expected: confirmPending, required: true },
    });
    expect(mockSaveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("uses screenshot method for ocr_confirm pending", async () => {
    const ocrPending = { ...confirmPending, kind: "ocr_confirm" as const };
    mockGetDiscordBotPending.mockResolvedValue({
      allianceId: ALLIANCE,
      pending: ocrPending,
    });

    const result = await confirm("yes");

    expect(result.action.type).toBe("set_thp");
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
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
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
  });

  it("rejects confirmation without a live discord link to the commander member", async () => {
    mockListDiscordLinksForUser.mockResolvedValue([
      { ...link, ashedMemberId: "someone-else" },
    ]);

    const result = await confirm("yes");

    expect(result.reply).toBe("errors.noConfirm");
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
  });

  it("rejects confirmation when the commander left the alliance", async () => {
    mockGetCommanderMembershipInAlliance.mockResolvedValue(null);

    const result = await confirm("yes");

    expect(result.reply).toBe("errors.noConfirm");
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
  });

  it("decline clears pending without mutation", async () => {
    const result = await confirm("no");

    expect(result.action.type).toBe("none");
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
    expect(mockSaveDiscordBotPending).toHaveBeenCalledWith(
      ALLIANCE,
      DISCORD,
      null,
    );
  });
});
