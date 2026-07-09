import { describe, expect, it } from "vitest";

import { isThpConfirmPending } from "@/lib/discord/bot-pending-guards.shared";
import { parseStoredThpPending } from "@/lib/thp/pending-state";
import { parseStoredVrPending } from "@/lib/vr/pending-state";

describe("parseStoredThpPending", () => {
  it("parses THP anomaly confirm pending", () => {
    expect(
      parseStoredThpPending({
        kind: "anomaly_confirm",
        proposedTotal: 999_999_999,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedTotal: 999_999_999,
      proposedBreakdown: null,
      commanderId: "cmd-1",
    });
  });

  it("parses THP ocr confirm pending", () => {
    expect(
      parseStoredThpPending({
        kind: "ocr_confirm",
        proposedTotal: 150_000_000,
        proposedBreakdown: null,
        commanderId: "cmd-2",
      }),
    ).toEqual({
      kind: "ocr_confirm",
      proposedTotal: 150_000_000,
      proposedBreakdown: null,
      commanderId: "cmd-2",
    });
  });

  it("normalizes stored confirm fields", () => {
    expect(
      parseStoredThpPending({
        kind: "ocr_confirm",
        proposedTotal: 150_000_000,
        proposedBreakdown: {
          heroLevel: 1.4,
          decorationsAndBuildings: 2.5,
          gear: 3,
          exclusiveWeapons: 4,
          heroTier: 5,
          heroSkill: 6,
          wallOfHonor: 7,
        },
        commanderId: " cmd-3 ",
      }),
    ).toEqual({
      kind: "ocr_confirm",
      proposedTotal: 150_000_000,
      proposedBreakdown: {
        heroLevel: 1,
        decorationsAndBuildings: 3,
        gear: 3,
        exclusiveWeapons: 4,
        heroTier: 5,
        heroSkill: 6,
        wallOfHonor: 7,
      },
      commanderId: "cmd-3",
    });
  });

  it("rejects non-finite confirm totals", () => {
    expect(
      parseStoredThpPending({
        kind: "anomaly_confirm",
        proposedTotal: Number.POSITIVE_INFINITY,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBeNull();
  });

  it("rejects VR anomaly pending shape", () => {
    expect(
      parseStoredThpPending({
        kind: "anomaly_confirm",
        proposedVr: 4200,
        ashedMemberId: "member-1",
      }),
    ).toBeNull();
  });
});

describe("discord_bot_pending THP confirm round-trip", () => {
  it("THP pending survives parse order used by getDiscordBotPending", () => {
    const stored = {
      kind: "anomaly_confirm",
      proposedTotal: 999_999_999,
      proposedBreakdown: null,
      commanderId: "cmd-1",
    };

    const parsed =
      parseStoredThpPending(stored) ?? parseStoredVrPending(stored);

    expect(parsed).toEqual(stored);
    expect(isThpConfirmPending(parsed)).toBe(true);
  });
});
