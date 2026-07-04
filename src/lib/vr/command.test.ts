import { describe, expect, it } from "vitest";

import { createDiscordTranslator } from "@/lib/discord/i18n";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";

const translate = createDiscordTranslator("en-US");

describe("processVrCommand", () => {
  const base = {
    ashedMemberId: "member-1",
    reporterCount: 10,
    peerMax: 7000,
    pending: null,
    translate,
    seasonKey: "1",
  };

  it("increments by one institute level (including +400 steps)", () => {
    const result = processVrCommand({ ...base, seasonHigh: 3000 });
    expect(result.action).toEqual({
      type: "set_vr",
      vr: 3400,
      ashedMemberId: "member-1",
    });
  });

  it("starts at season min VR when no season high exists", () => {
    const result = processVrCommand({ ...base, seasonHigh: null });
    expect(result.action).toMatchObject({ type: "set_vr", vr: 100 });
  });

  it("rejects invalid explicit values with nearest ladder neighbors", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 3000,
      explicitLevel: 3300,
    });
    expect(result.action).toEqual({ type: "none" });
    expect(result.reply).toMatch(/3000/);
    expect(result.reply).toMatch(/3400/);
  });

  it("blocks downgrade beyond one institute level", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 3400,
      explicitLevel: 2750,
    });
    expect(result.reply).toMatch(/more than one below/i);
  });

  it("prompts anomaly confirm when far above peers", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 3000,
      explicitLevel: 8000,
      peerMax: 3000,
    });
    expect(result.needsConfirmation).toBe(true);
    expect(result.pending?.kind).toBe("anomaly_confirm");
  });

  it("respects season max institute VR", () => {
    const result = processVrCommand({
      ...base,
      seasonHigh: 9500,
      explicitLevel: 10000,
      peerMax: 9900,
    });
    expect(result.action).toEqual({
      type: "set_vr",
      vr: 10000,
      ashedMemberId: "member-1",
    });
    const over = processVrCommand({
      ...base,
      seasonHigh: 10000,
      peerMax: 9900,
    });
    expect(over.action).toEqual({ type: "none" });
    expect(over.reply).toMatch(/max institute level \(30\)/i);
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
      translate,
      seasonKey: "1",
    });
    expect(result.action).toMatchObject({ type: "set_vr", vr: 8000 });
  });
});
