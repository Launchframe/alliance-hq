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

vi.mock("@/lib/vr/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/vr/repository")>();
  return {
    ...original,
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
  };
});

import type { ActivityPrincipal } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
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
  VrPendingChangedError,
  VrSubmissionChangedError,
} from "@/lib/vr/repository";
import { auditWebVrCommand } from "@/lib/vr/web-vr-audit.server";
import { handleWebVrCommand, loadMyVrForUser } from "@/lib/vr/web-vr.server";

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: "hq-1",
  sessionId: "session-1",
  currentAllianceId: "alliance-1",
  permissions: new Set(["members:read"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    allianceId: "alliance-1",
    hqUserId: "hq-1",
    principal: PRINCIPAL,
    locale: "en-US",
    ...overrides,
  };
}

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
    vi.mocked(upsertMemberSeasonVr).mockReset();
  });

  it("returns member_link_required when not linked", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    const result = await handleWebVrCommand(baseInput());
    expect(result).toEqual({ code: "member_link_required" });
    expect(auditWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: null,
        result: { code: "member_link_required" },
      }),
    );
  });

  it("returns member_link_required before member lookup when principal mismatches", async () => {
    const result = await handleWebVrCommand(
      baseInput({
        principal: { ...PRINCIPAL, currentAllianceId: "alliance-2" },
      }),
    );
    expect(result).toEqual({ code: "member_link_required" });
    expect(getHqMemberLinkForUser).not.toHaveBeenCalled();
  });

  it("returns member_link_required when principal session differs", async () => {
    const result = await handleWebVrCommand(
      baseInput({
        principal: { ...PRINCIPAL, sessionId: "session-other" },
      }),
    );
    expect(result).toEqual({ code: "member_link_required" });
    expect(getHqMemberLinkForUser).not.toHaveBeenCalled();
  });

  it("bumps to season min VR when no season high", async () => {
    const result = await handleWebVrCommand(baseInput());
    expect(result).toMatchObject({ status: "set_vr", newVr: 100 });
    expect(auditWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        commanderId: "cmd-1",
        result: expect.objectContaining({ status: "set_vr", newVr: 100 }),
      }),
    );
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVr: 100,
        eventSource: "web",
        hqUserId: "hq-1",
        activity: {
          identity: { kind: "web", principal: PRINCIPAL },
          expectedPreviousBaseVr: null,
        },
      }),
    );
  });

  it("passes the caller's season high read as expectedPreviousBaseVr", async () => {
    vi.mocked(getMemberSeasonHigh).mockResolvedValue(3000);
    const result = await handleWebVrCommand(baseInput());
    expect(result).toMatchObject({ status: "set_vr", newVr: 3400 });
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVr: 3400,
        activity: expect.objectContaining({
          expectedPreviousBaseVr: 3000,
        }),
      }),
    );
  });

  it("threads stored pending as optional consumption on direct submit", async () => {
    const storedPending = {
      kind: "pick_character" as const,
      linkIds: ["link-1"],
    };
    vi.mocked(getHqVrPending).mockResolvedValue(storedPending);
    const result = await handleWebVrCommand(baseInput());
    expect(result).toMatchObject({ status: "set_vr" });
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          pending: { expected: storedPending, required: false },
        }),
      }),
    );
  });

  it("keeps a same-season anomaly prompt instead of writing", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
      seasonKey: "1",
    });
    const result = await handleWebVrCommand(baseInput());
    expect(result).toMatchObject({ status: "anomaly_confirm" });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
    expect(saveHqVrPending).toHaveBeenCalledWith(
      "alliance-1",
      "hq-1",
      expect.objectContaining({ kind: "anomaly_confirm" }),
    );
  });

  it("handles anomaly confirmation", async () => {
    const pending = {
      kind: "anomaly_confirm" as const,
      proposedVr: 8000,
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
      seasonKey: "1",
    };
    vi.mocked(getHqVrPending).mockResolvedValue(pending);
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toMatchObject({ status: "set_vr", newVr: 8000 });
    expect(saveHqVrPending).not.toHaveBeenCalled();
    expect(upsertMemberSeasonVr).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVr: 8000,
        eventSource: "web",
        activity: {
          identity: { kind: "web", principal: PRINCIPAL },
          expectedPreviousBaseVr: null,
          pending: { expected: pending, required: true },
        },
      }),
    );
    expect(translate).toBeDefined();
  });

  it("rejects confirm when pending targets a different season", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
      seasonKey: "2",
    });
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: translate("errors.noConfirm"),
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("rejects confirm when pending has no season binding", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
    });
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: translate("errors.noConfirm"),
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("denies confirm when the resolved season changes between lookups", async () => {
    vi.mocked(resolveVrSeasonContext)
      .mockResolvedValueOnce({
        seasonKey: "1",
        isPostSeason: false,
        vrUpdatesLocked: false,
        priorSeason: null,
        vrSandboxActive: false,
      })
      .mockResolvedValueOnce({
        seasonKey: "2",
        isPostSeason: false,
        vrUpdatesLocked: false,
        priorSeason: "1",
        vrSandboxActive: false,
      });
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
      seasonKey: "1",
    });
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: translate("errors.noConfirm"),
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
    expect(saveHqVrPending).not.toHaveBeenCalled();
  });

  it("rejects confirm when pending member does not match the link", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-other",
      seasonKey: "1",
    });
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: translate("errors.noConfirm"),
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("rejects confirm when pending commander does not match", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
      commanderId: "cmd-other",
      seasonKey: "1",
    });
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: translate("errors.noConfirm"),
    });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
  });

  it("declines confirmation without writes", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
      seasonKey: "1",
    });
    const result = await handleWebVrCommand(baseInput({ confirm: "no" }));
    expect(result).toMatchObject({ status: "anomaly_rejected" });
    expect(upsertMemberSeasonVr).not.toHaveBeenCalled();
    expect(saveHqVrPending).toHaveBeenCalledWith("alliance-1", "hq-1", null);
  });

  it("maps a stale pending CAS failure to noConfirm", async () => {
    vi.mocked(getHqVrPending).mockResolvedValue({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
      seasonKey: "1",
    });
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(
      new VrPendingChangedError(),
    );
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput({ confirm: "yes" }));
    expect(result).toEqual({
      status: "error",
      message: translate("errors.noConfirm"),
    });
    expect(auditWebVrCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: null,
        result: { status: "error", message: translate("errors.noConfirm") },
      }),
    );
  });

  it("maps activity write failures to saveBlocked", async () => {
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(
      new ActivityWriteError({
        eventKey: "vr.submitted",
        failureCategory: "unknown",
      }),
    );
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput());
    expect(result).toEqual({
      status: "error",
      message: translate("activity.saveBlocked"),
    });
  });

  it("maps stale submission races to saveBlocked", async () => {
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(
      new VrSubmissionChangedError(),
    );
    const translate = createDiscordTranslator("en-US");
    const result = await handleWebVrCommand(baseInput());
    expect(result).toEqual({
      status: "error",
      message: translate("activity.saveBlocked"),
    });
  });

  it("rethrows unrelated errors", async () => {
    vi.mocked(upsertMemberSeasonVr).mockRejectedValue(new Error("db down"));
    await expect(handleWebVrCommand(baseInput())).rejects.toThrow("db down");
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
    const result = await handleWebVrCommand(baseInput());

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

    const result = await handleWebVrCommand(
      baseInput({ explicitInstituteLevel: 1 }),
    );

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

    const result = await handleWebVrCommand(
      baseInput({ explicitInstituteLevel: 20 }),
    );

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
