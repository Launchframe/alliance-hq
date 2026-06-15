import { describe, expect, it } from "vitest";

import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";

describe("processVrCommand", () => {
  const base = {
    ashedMemberId: "member-1",
    reporterCount: 10,
    peerMax: 7250,
    pending: null,
  };

  it("increments from season high by 250", () => {
    const result = processVrCommand({ ...base, seasonHigh: 7250 });
    expect(result.action).toEqual({
      type: "set_vr",
      vr: 7500,
      ashedMemberId: "member-1",
    });
  });

  it("starts at 250 when no season high exists", () => {
    const result = processVrCommand({ ...base, seasonHigh: null });
    expect(result.action).toMatchObject({ type: "set_vr", vr: 250 });
  });

  it("rejects invalid explicit values", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 7250,
      explicitLevel: 7251,
    });
    expect(result.action).toEqual({ type: "none" });
  });

  it("blocks downgrade beyond one ladder step", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 7500,
      explicitLevel: 7000,
    });
    expect(result.reply).toMatch(/one step/i);
  });

  it("prompts anomaly confirm when far above peers", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 7250,
      explicitLevel: 8000,
    });
    expect(result.needsConfirmation).toBe(true);
    expect(result.pending?.kind).toBe("anomaly_confirm");
  });
});

describe("processVrConfirmation", () => {
  it("applies VR on yes", () => {
    const result = processVrConfirmation({
      answer: "yes",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 8000,
        ashedMemberId: "member-1",
      },
    });
    expect(result.action).toMatchObject({ type: "set_vr", vr: 8000 });
  });
});
