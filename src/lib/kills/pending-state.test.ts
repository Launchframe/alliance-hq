import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as dbModule from "@/lib/db";
import {
  isKillsConfirmPending,
  isThpConfirmPending,
} from "@/lib/discord/bot-pending-guards.shared";
import { parseStoredKillsPending } from "@/lib/kills/pending-state";
import { getDiscordBotPending } from "@/lib/vr/repository";

function mockStoredPendingRow(pendingJson: unknown) {
  vi.spyOn(dbModule, "getDb").mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                allianceId: "ally-1",
                pendingJson,
                expiresAt: new Date(Date.now() + 60_000),
              },
            ]),
        }),
      }),
    }),
  } as never);
}

describe("parseStoredKillsPending", () => {
  it("parses anomaly confirm pending", () => {
    expect(
      parseStoredKillsPending({
        kind: "anomaly_confirm",
        proposedTotal: 2_500,
        commanderId: "cmd-1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedTotal: 2_500,
      commanderId: "cmd-1",
    });
  });

  it("parses ocr confirm pending", () => {
    expect(
      parseStoredKillsPending({
        kind: "ocr_confirm",
        proposedTotal: 3_000,
        commanderId: " cmd-2 ",
      }),
    ).toEqual({
      kind: "ocr_confirm",
      proposedTotal: 3_000,
      commanderId: "cmd-2",
    });
  });

  it("rejects THP-shaped confirm carrying proposedBreakdown", () => {
    expect(
      parseStoredKillsPending({
        kind: "anomaly_confirm",
        proposedTotal: 2_500,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBeNull();
  });

  it("rejects non-finite confirm totals", () => {
    expect(
      parseStoredKillsPending({
        kind: "ocr_confirm",
        proposedTotal: Number.POSITIVE_INFINITY,
        commanderId: "cmd-1",
      }),
    ).toBeNull();
  });

  it("parses pick_character carrying proposedTotal", () => {
    expect(
      parseStoredKillsPending({
        kind: "pick_character",
        linkIds: ["link-1", "link-2"],
        proposedTotal: 1_500,
      }),
    ).toEqual({
      kind: "pick_character",
      linkIds: ["link-1", "link-2"],
      proposedTotal: 1_500,
    });
  });

  it("normalizes a null proposedTotal on pick_character", () => {
    expect(
      parseStoredKillsPending({
        kind: "pick_character",
        linkIds: ["link-1"],
        proposedTotal: null,
      }),
    ).toEqual({
      kind: "pick_character",
      linkIds: ["link-1"],
      proposedTotal: null,
    });
  });

  it("rejects pick_character without proposedTotal (THP/VR picker shape)", () => {
    expect(
      parseStoredKillsPending({
        kind: "pick_character",
        linkIds: ["link-1"],
      }),
    ).toBeNull();
  });
});

describe("getDiscordBotPending kills/THP disambiguation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes a kills anomaly confirm to the kills parser", async () => {
    mockStoredPendingRow({
      kind: "anomaly_confirm",
      proposedTotal: 2_500,
      commanderId: "cmd-1",
    });

    const row = await getDiscordBotPending("discord-1");

    expect(row?.allianceId).toBe("ally-1");
    expect(row?.pending).toEqual({
      kind: "anomaly_confirm",
      proposedTotal: 2_500,
      commanderId: "cmd-1",
    });
    expect(row?.pending && "proposedBreakdown" in row.pending).toBe(false);
    expect(isKillsConfirmPending(row?.pending)).toBe(true);
    expect(isThpConfirmPending(row?.pending)).toBe(false);
  });

  it("routes a kills ocr confirm to the kills parser", async () => {
    mockStoredPendingRow({
      kind: "ocr_confirm",
      proposedTotal: 3_000,
      commanderId: "cmd-2",
    });

    const row = await getDiscordBotPending("discord-1");

    expect(row?.pending).toEqual({
      kind: "ocr_confirm",
      proposedTotal: 3_000,
      commanderId: "cmd-2",
    });
    expect(isKillsConfirmPending(row?.pending)).toBe(true);
  });

  it("routes a kills pick_character carrying proposedTotal to the kills parser", async () => {
    mockStoredPendingRow({
      kind: "pick_character",
      linkIds: ["link-1", "link-2"],
      proposedTotal: 1_500,
    });

    const row = await getDiscordBotPending("discord-1");

    expect(row?.pending).toEqual({
      kind: "pick_character",
      linkIds: ["link-1", "link-2"],
      proposedTotal: 1_500,
    });
  });

  it("keeps routing THP confirms with proposedBreakdown to the THP parser", async () => {
    mockStoredPendingRow({
      kind: "anomaly_confirm",
      proposedTotal: 150_000_000,
      proposedBreakdown: null,
      commanderId: "cmd-1",
    });

    const row = await getDiscordBotPending("discord-1");

    expect(isThpConfirmPending(row?.pending)).toBe(true);
    expect(row?.pending).toMatchObject({
      kind: "anomaly_confirm",
      proposedTotal: 150_000_000,
      proposedBreakdown: null,
    });
  });

  it("keeps routing generic pick_character rows to the THP parser", async () => {
    mockStoredPendingRow({
      kind: "pick_character",
      linkIds: ["link-9"],
    });

    const row = await getDiscordBotPending("discord-1");

    expect(row?.pending).toEqual({
      kind: "pick_character",
      linkIds: ["link-9"],
    });
    expect(row?.pending && "proposedTotal" in row.pending).toBe(false);
  });

  it("keeps routing VR anomaly pending to the VR parser", async () => {
    mockStoredPendingRow({
      kind: "anomaly_confirm",
      proposedVr: 4200,
      ashedMemberId: "member-1",
    });

    const row = await getDiscordBotPending("discord-1");

    expect(row?.pending).toMatchObject({
      kind: "anomaly_confirm",
      proposedVr: 4200,
      ashedMemberId: "member-1",
    });
    expect(isKillsConfirmPending(row?.pending)).toBe(false);
  });
});
