import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetHqMemberLinkForUser = vi.fn();
const mockGetCommanderIdForMember = vi.fn();
const mockParsePowerDetailsImage = vi.fn();
const mockGetHqThpPending = vi.fn();
const mockGetCommanderThpState = vi.fn();
const mockCountAllianceThpReporters = vi.fn();
const mockListAllianceCommanderThpRows = vi.fn();
const mockSaveHqThpPending = vi.fn();
const mockUpsertCommanderThp = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: (...args: unknown[]) =>
    mockGetHqMemberLinkForUser(...args),
}));

vi.mock("@/lib/thp/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/thp/repository")>();
  return {
    ...original,
    getCommanderIdForMember: (...args: unknown[]) =>
      mockGetCommanderIdForMember(...args),
    getHqThpPending: (...args: unknown[]) => mockGetHqThpPending(...args),
    getCommanderThpState: (...args: unknown[]) =>
      mockGetCommanderThpState(...args),
    countAllianceThpReporters: (...args: unknown[]) =>
      mockCountAllianceThpReporters(...args),
    listAllianceCommanderThpRows: (...args: unknown[]) =>
      mockListAllianceCommanderThpRows(...args),
    saveHqThpPending: (...args: unknown[]) => mockSaveHqThpPending(...args),
    upsertCommanderThp: (...args: unknown[]) => mockUpsertCommanderThp(...args),
  };
});

vi.mock("@/lib/discord/i18n", () => ({
  createDiscordTranslator: () => (key: string) => key,
  normalizeDiscordBotLocale: (value: string | undefined) => value ?? "en-US",
}));

vi.mock("@/lib/thp/hero-power-ocr/parse-power-details-image", () => ({
  parsePowerDetailsImage: (...args: unknown[]) =>
    mockParsePowerDetailsImage(...args),
}));

import type { ActivityPrincipal } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
import { handleWebThpCommand } from "@/lib/thp/web-thp.server";
import { ThpPendingChangedError } from "@/lib/thp/repository";

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: "user-1",
  sessionId: "sess-1",
  currentAllianceId: "alliance-1",
  permissions: new Set(["members:read"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    allianceId: "alliance-1",
    hqUserId: "user-1",
    principal: PRINCIPAL,
    locale: "en-US",
    ...overrides,
  };
}

describe("handleWebThpCommand screenshot OCR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
  });

  it("returns ocrFailed when OCR header total is out of range and no rows parsed", async () => {
    mockParsePowerDetailsImage.mockResolvedValue({
      heroPowerTotal: 2_000_000_000,
      breakdown: {},
      complete: false,
    });

    const result = await handleWebThpCommand(
      baseInput({ screenshotBuffer: Buffer.from("fake-png") }),
    );

    expect(result).toEqual({
      status: "error",
      message: "thp.ocrFailed",
    });
  });

  it("returns ocr_partial when some rows parse but total is unusable", async () => {
    mockParsePowerDetailsImage.mockResolvedValue({
      heroPowerTotal: null,
      breakdown: {
        heroLevel: 85_000_000,
        gear: 13_000_000,
      },
      complete: false,
    });

    const result = await handleWebThpCommand(
      baseInput({ screenshotBuffer: Buffer.from("fake-png") }),
    );

    expect(result).toEqual({
      status: "ocr_partial",
      message: "thp.ocrPartial",
      partialBreakdown: {
        heroLevel: 85_000_000,
        gear: 13_000_000,
      },
    });
  });

  it("returns validation_error for manual invalid total (not screenshot)", async () => {
    const result = await handleWebThpCommand(baseInput({ total: 2_000_000_000 }));

    expect(result).toEqual({
      status: "validation_error",
      message: "thp.invalidTotal",
    });
    expect(mockParsePowerDetailsImage).not.toHaveBeenCalled();
  });
});

describe("handleWebThpCommand activity wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
    mockGetHqThpPending.mockResolvedValue(null);
    mockGetCommanderThpState.mockResolvedValue(null);
    mockCountAllianceThpReporters.mockResolvedValue(0);
    mockListAllianceCommanderThpRows.mockResolvedValue([]);
    mockUpsertCommanderThp.mockResolvedValue(true);
  });

  it("rejects a principal bound to another user or alliance before any lookup", async () => {
    const otherUser = await handleWebThpCommand(
      baseInput({
        principal: { ...PRINCIPAL, hqUserId: "someone-else" },
      }),
    );
    expect(otherUser).toEqual({ code: "member_link_required" });
    expect(mockGetHqMemberLinkForUser).not.toHaveBeenCalled();

    const otherAlliance = await handleWebThpCommand(
      baseInput({
        principal: { ...PRINCIPAL, currentAllianceId: "other-alliance" },
      }),
    );
    expect(otherAlliance).toEqual({ code: "member_link_required" });
    expect(mockGetHqMemberLinkForUser).not.toHaveBeenCalled();
  });

  it("passes web identity and manual method to the upsert", async () => {
    const result = await handleWebThpCommand(baseInput({ total: 125_000_000 }));

    expect(result).toMatchObject({ status: "set_thp", newThp: 125_000_000 });
    expect(mockUpsertCommanderThp).toHaveBeenCalledTimes(1);
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.commanderId).toBe("cmd-1");
    expect(call.activity).toEqual({
      identity: { kind: "web", principal: PRINCIPAL },
      method: "manual",
    });
    expect(mockSaveHqThpPending).not.toHaveBeenCalled();
  });

  it("forwards the consumed pending expectation on the write path", async () => {
    const stale = {
      kind: "anomaly_confirm" as const,
      proposedTotal: 90_000_000,
      proposedBreakdown: null,
      commanderId: "cmd-1",
    };
    mockGetHqThpPending.mockResolvedValue(stale);

    const result = await handleWebThpCommand(baseInput({ total: 125_000_000 }));

    expect(result).toMatchObject({ status: "set_thp" });
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity.pending).toEqual({
      expected: stale,
      required: false,
    });
  });

  it("persists the confirm prompt pending without mutating", async () => {
    mockCountAllianceThpReporters.mockResolvedValue(25);
    mockListAllianceCommanderThpRows.mockResolvedValue([
      { commanderId: "peer-1", total: 1_000_000 },
    ]);

    const result = await handleWebThpCommand(baseInput({ total: 150_000_000 }));

    expect(result).toMatchObject({
      status: "anomaly_confirm",
      proposedThp: 150_000_000,
    });
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
    expect(mockSaveHqThpPending).toHaveBeenCalledWith(
      "alliance-1",
      "user-1",
      expect.objectContaining({ kind: "anomaly_confirm" }),
    );
  });

  it("maps ThpPendingChangedError to the noConfirm error without mutation", async () => {
    mockUpsertCommanderThp.mockRejectedValue(new ThpPendingChangedError());

    const result = await handleWebThpCommand(baseInput({ total: 125_000_000 }));

    expect(result).toEqual({
      status: "error",
      message: "errors.noConfirm",
    });
  });

  it("maps ActivityWriteError to the saveBlocked error without success", async () => {
    mockUpsertCommanderThp.mockRejectedValue(
      new ActivityWriteError({
        eventKey: "thp.submitted",
        failureCategory: "unknown",
      }),
    );

    const result = await handleWebThpCommand(baseInput({ total: 125_000_000 }));

    expect(result).toEqual({
      status: "error",
      message: "activity.saveBlocked",
    });
  });

  it("rethrows unrelated errors", async () => {
    mockUpsertCommanderThp.mockRejectedValue(new Error("boom"));

    await expect(
      handleWebThpCommand(baseInput({ total: 125_000_000 })),
    ).rejects.toThrow("boom");
  });
});

describe("handleWebThpCommand confirmation", () => {
  const pending = {
    kind: "anomaly_confirm" as const,
    proposedTotal: 150_000_000,
    proposedBreakdown: null,
    commanderId: "cmd-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
    mockGetHqThpPending.mockResolvedValue(pending);
    mockGetCommanderThpState.mockResolvedValue(null);
    mockListAllianceCommanderThpRows.mockResolvedValue([]);
    mockUpsertCommanderThp.mockResolvedValue(true);
  });

  it("confirms with required pending consumption and manual method", async () => {
    const result = await handleWebThpCommand(baseInput({ confirm: "yes" }));

    expect(result).toMatchObject({ status: "set_thp", newThp: 150_000_000 });
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity).toEqual({
      identity: { kind: "web", principal: PRINCIPAL },
      method: "manual",
      pending: { expected: pending, required: true },
    });
    expect(mockSaveHqThpPending).not.toHaveBeenCalled();
  });

  it("uses screenshot method for ocr_confirm pending", async () => {
    mockGetHqThpPending.mockResolvedValue({ ...pending, kind: "ocr_confirm" });

    const result = await handleWebThpCommand(baseInput({ confirm: "yes" }));

    expect(result).toMatchObject({ status: "set_thp" });
    const call = mockUpsertCommanderThp.mock.calls[0]![0];
    expect(call.activity.method).toBe("screenshot");
    expect(call.source).toBe("screenshot_ocr");
    expect(call.activity.pending.required).toBe(true);
  });

  it("decline persists cleared pending and never mutates", async () => {
    const result = await handleWebThpCommand(baseInput({ confirm: "no" }));

    expect(result).toMatchObject({ status: "anomaly_rejected" });
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
    expect(mockSaveHqThpPending).toHaveBeenCalledWith(
      "alliance-1",
      "user-1",
      null,
    );
  });

  it("returns noConfirm without a stored pending", async () => {
    mockGetHqThpPending.mockResolvedValue(null);

    const result = await handleWebThpCommand(baseInput({ confirm: "yes" }));

    expect(result).toEqual({
      status: "error",
      message: "errors.noConfirm",
    });
    expect(mockUpsertCommanderThp).not.toHaveBeenCalled();
  });
});
