import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetHqMemberLinkForUser = vi.fn();
const mockGetCommanderIdForMember = vi.fn();
const mockParseKillsDetailsImage = vi.fn();
const mockGetHqKillsPending = vi.fn();
const mockGetCommanderKillsState = vi.fn();
const mockCountAllianceKillsReporters = vi.fn();
const mockListAllianceCommanderKillsRows = vi.fn();
const mockSaveHqKillsPending = vi.fn();
const mockUpsertCommanderKills = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: (...args: unknown[]) =>
    mockGetHqMemberLinkForUser(...args),
}));

vi.mock("@/lib/kills/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/kills/repository")>();
  return {
    ...original,
    getCommanderIdForMember: (...args: unknown[]) =>
      mockGetCommanderIdForMember(...args),
    getHqKillsPending: (...args: unknown[]) => mockGetHqKillsPending(...args),
    getCommanderKillsState: (...args: unknown[]) =>
      mockGetCommanderKillsState(...args),
    countAllianceKillsReporters: (...args: unknown[]) =>
      mockCountAllianceKillsReporters(...args),
    listAllianceCommanderKillsRows: (...args: unknown[]) =>
      mockListAllianceCommanderKillsRows(...args),
    saveHqKillsPending: (...args: unknown[]) => mockSaveHqKillsPending(...args),
    upsertCommanderKills: (...args: unknown[]) =>
      mockUpsertCommanderKills(...args),
  };
});

vi.mock("@/lib/discord/i18n", () => ({
  createDiscordTranslator: () => (key: string) => key,
}));

vi.mock("@/lib/kills/kill-count-ocr/parse-kills-details-image", () => ({
  parseKillsDetailsImage: (...args: unknown[]) =>
    mockParseKillsDetailsImage(...args),
}));

import type { ActivityPrincipal } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
import { handleWebKillsCommand } from "@/lib/kills/web-kills.server";
import { KillsPendingChangedError } from "@/lib/kills/repository";

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

describe("handleWebKillsCommand screenshot OCR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
  });

  it("returns ocrFailed when OCR finds no usable total", async () => {
    mockParseKillsDetailsImage.mockResolvedValue({ totalKills: null });

    const result = await handleWebKillsCommand(
      baseInput({ screenshotBuffer: Buffer.from("fake-png") }),
    );

    expect(result).toEqual({
      status: "error",
      message: "kills.ocrFailed",
    });
  });

  it("returns validation_error for manual invalid total (not screenshot)", async () => {
    const result = await handleWebKillsCommand(
      baseInput({ total: 51_000_000_000 }),
    );

    expect(result).toEqual({
      status: "validation_error",
      message: "kills.invalidTotal",
    });
    expect(mockParseKillsDetailsImage).not.toHaveBeenCalled();
  });

  it("persists an ocr_confirm prompt without mutating on screenshot read", async () => {
    mockParseKillsDetailsImage.mockResolvedValue({ totalKills: 3_000 });
    mockGetHqKillsPending.mockResolvedValue(null);
    mockGetCommanderKillsState.mockResolvedValue(null);
    mockCountAllianceKillsReporters.mockResolvedValue(0);
    mockListAllianceCommanderKillsRows.mockResolvedValue([]);

    const result = await handleWebKillsCommand(
      baseInput({ screenshotBuffer: Buffer.from("fake-png") }),
    );

    expect(result).toMatchObject({
      status: "ocr_confirm",
      proposedKills: 3_000,
    });
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
    expect(mockSaveHqKillsPending).toHaveBeenCalledWith(
      "alliance-1",
      "user-1",
      expect.objectContaining({ kind: "ocr_confirm" }),
    );
  });
});

describe("handleWebKillsCommand activity wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
    mockGetHqKillsPending.mockResolvedValue(null);
    mockGetCommanderKillsState.mockResolvedValue(null);
    mockCountAllianceKillsReporters.mockResolvedValue(0);
    mockListAllianceCommanderKillsRows.mockResolvedValue([]);
    mockUpsertCommanderKills.mockResolvedValue(true);
  });

  it("rejects a principal bound to another user or alliance before any lookup", async () => {
    const otherUser = await handleWebKillsCommand(
      baseInput({
        principal: { ...PRINCIPAL, hqUserId: "someone-else" },
      }),
    );
    expect(otherUser).toEqual({ code: "member_link_required" });
    expect(mockGetHqMemberLinkForUser).not.toHaveBeenCalled();

    const otherAlliance = await handleWebKillsCommand(
      baseInput({
        principal: { ...PRINCIPAL, currentAllianceId: "other-alliance" },
      }),
    );
    expect(otherAlliance).toEqual({ code: "member_link_required" });
    expect(mockGetHqMemberLinkForUser).not.toHaveBeenCalled();
  });

  it("passes web identity and manual method to the upsert", async () => {
    const result = await handleWebKillsCommand(baseInput({ total: 125_000 }));

    expect(result).toMatchObject({ status: "set_kills", newKills: 125_000 });
    expect(mockUpsertCommanderKills).toHaveBeenCalledTimes(1);
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.commanderId).toBe("cmd-1");
    expect(call.activity).toEqual({
      identity: { kind: "web", principal: PRINCIPAL },
      method: "manual",
    });
    expect(mockSaveHqKillsPending).not.toHaveBeenCalled();
  });

  it("forwards the consumed pending expectation on the write path", async () => {
    const stale = {
      kind: "anomaly_confirm" as const,
      proposedTotal: 90_000,
      commanderId: "cmd-1",
    };
    mockGetHqKillsPending.mockResolvedValue(stale);

    const result = await handleWebKillsCommand(baseInput({ total: 125_000 }));

    expect(result).toMatchObject({ status: "set_kills" });
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity.pending).toEqual({
      expected: stale,
      required: false,
    });
  });

  it("persists the confirm prompt pending without mutating", async () => {
    mockCountAllianceKillsReporters.mockResolvedValue(12);
    mockListAllianceCommanderKillsRows.mockResolvedValue([
      { commanderId: "peer-1", total: 100 },
    ]);

    const result = await handleWebKillsCommand(
      baseInput({ total: 60_000_000 }),
    );

    expect(result).toMatchObject({
      status: "anomaly_confirm",
      proposedKills: 60_000_000,
    });
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
    expect(mockSaveHqKillsPending).toHaveBeenCalledWith(
      "alliance-1",
      "user-1",
      expect.objectContaining({ kind: "anomaly_confirm" }),
    );
  });

  it("maps KillsPendingChangedError to the noConfirm error without mutation", async () => {
    mockUpsertCommanderKills.mockRejectedValue(new KillsPendingChangedError());

    const result = await handleWebKillsCommand(baseInput({ total: 125_000 }));

    expect(result).toEqual({
      status: "error",
      message: "errors.noConfirm",
    });
  });

  it("maps ActivityWriteError to the saveBlocked error without success", async () => {
    mockUpsertCommanderKills.mockRejectedValue(
      new ActivityWriteError({
        eventKey: "kills.submitted",
        failureCategory: "unknown",
      }),
    );

    const result = await handleWebKillsCommand(baseInput({ total: 125_000 }));

    expect(result).toEqual({
      status: "error",
      message: "activity.saveBlocked",
    });
  });

  it("rethrows unrelated errors", async () => {
    mockUpsertCommanderKills.mockRejectedValue(new Error("boom"));

    await expect(
      handleWebKillsCommand(baseInput({ total: 125_000 })),
    ).rejects.toThrow("boom");
  });
});

describe("handleWebKillsCommand confirmation", () => {
  const pending = {
    kind: "anomaly_confirm" as const,
    proposedTotal: 150_000,
    commanderId: "cmd-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
    mockGetHqKillsPending.mockResolvedValue(pending);
    mockGetCommanderKillsState.mockResolvedValue(null);
    mockListAllianceCommanderKillsRows.mockResolvedValue([]);
    mockUpsertCommanderKills.mockResolvedValue(true);
  });

  it("confirms with required pending consumption and manual method", async () => {
    const result = await handleWebKillsCommand(baseInput({ confirm: "yes" }));

    expect(result).toMatchObject({ status: "set_kills", newKills: 150_000 });
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity).toEqual({
      identity: { kind: "web", principal: PRINCIPAL },
      method: "manual",
      pending: { expected: pending, required: true },
    });
    expect(call.source).toBe("web");
    expect(mockSaveHqKillsPending).not.toHaveBeenCalled();
  });

  it("uses screenshot method for ocr_confirm pending", async () => {
    mockGetHqKillsPending.mockResolvedValue({ ...pending, kind: "ocr_confirm" });

    const result = await handleWebKillsCommand(baseInput({ confirm: "yes" }));

    expect(result).toMatchObject({ status: "set_kills" });
    const call = mockUpsertCommanderKills.mock.calls[0]![0];
    expect(call.activity.method).toBe("screenshot");
    expect(call.source).toBe("screenshot_ocr");
    expect(call.activity.pending.required).toBe(true);
  });

  it("decline persists cleared pending and never mutates", async () => {
    const result = await handleWebKillsCommand(baseInput({ confirm: "no" }));

    expect(result).toMatchObject({ status: "anomaly_rejected" });
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
    expect(mockSaveHqKillsPending).toHaveBeenCalledWith(
      "alliance-1",
      "user-1",
      null,
    );
  });

  it("returns noConfirm without a stored pending", async () => {
    mockGetHqKillsPending.mockResolvedValue(null);

    const result = await handleWebKillsCommand(baseInput({ confirm: "yes" }));

    expect(result).toEqual({
      status: "error",
      message: "errors.noConfirm",
    });
    expect(mockUpsertCommanderKills).not.toHaveBeenCalled();
  });
});
