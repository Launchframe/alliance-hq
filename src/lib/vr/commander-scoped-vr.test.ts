import { describe, expect, it } from "vitest";

import { parseStoredVrPending } from "@/lib/vr/pending-state";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { selectTopVrChartCommanders } from "@/lib/vr/vr-progress-chart.shared";

describe("parseStoredVrPending", () => {
  it("accepts anomaly_confirm with commanderId", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedVr: 5000,
        commanderId: "cmd-1",
        ashedMemberId: "member-1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedVr: 5000,
      commanderId: "cmd-1",
      ashedMemberId: "member-1",
    });
  });

  it("accepts legacy anomaly_confirm with only ashedMemberId", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedVr: 5000,
        ashedMemberId: "member-1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedVr: 5000,
      ashedMemberId: "member-1",
    });
  });

  it("rejects THP-shaped pending", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedTotal: 1_000_000,
        commanderId: "cmd-1",
      }),
    ).toBeNull();
  });
});

describe("processVrCommand commanderId", () => {
  const translate = createDiscordTranslator("en-US");

  it("stores commanderId on anomaly pending and set_vr action", () => {
    const result = processVrCommand({
      explicitLevel: 8000,
      seasonHigh: 1000,
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
      pending: null,
      reporterCount: 20,
      peerMax: 2000,
      translate,
      seasonKey: "1",
    });
    expect(result.needsConfirmation).toBe(true);
    expect(result.pending).toMatchObject({
      kind: "anomaly_confirm",
      commanderId: "cmd-1",
      ashedMemberId: "member-1",
    });

    const confirmed = processVrConfirmation({
      answer: "yes",
      pending: result.pending!,
      translate,
      seasonKey: "1",
    });
    expect(confirmed.action).toMatchObject({
      type: "set_vr",
      commanderId: "cmd-1",
      ashedMemberId: "member-1",
    });
  });
});

describe("selectTopVrChartCommanders", () => {
  it("replaces the 10th slot with the viewer when viewer is outside top 10", () => {
    const ranked = Array.from({ length: 12 }, (_, i) => ({
      commanderId: `c${i + 1}`,
      currentBaseVr: 12000 - i * 100,
    }));
    const selected = selectTopVrChartCommanders(ranked, "c12", 10);
    expect(selected).toHaveLength(10);
    expect(selected.some((row) => row.commanderId === "c12")).toBe(true);
    expect(selected.some((row) => row.commanderId === "c10")).toBe(false);
  });
});
