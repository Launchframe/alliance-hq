import { describe, expect, it } from "vitest";

import {
  isKillsConfirmPending,
  isThpConfirmPending,
  isVrAnomalyConfirmPending,
  thpConfirmEventSource,
} from "@/lib/discord/bot-pending-guards.shared";
import { processThpConfirmation } from "@/lib/thp/command";

const translate = (key: string) => key;

describe("bot pending guards", () => {
  it("accepts THP confirm pending with proposedTotal", () => {
    expect(
      isThpConfirmPending({
        kind: "anomaly_confirm",
        proposedTotal: 150_000_000,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBe(true);
  });

  it("rejects kills pending mistaken for THP", () => {
    expect(
      isThpConfirmPending({
        kind: "anomaly_confirm",
        proposedTotal: 150_000_000,
        commanderId: "cmd-1",
      }),
    ).toBe(false);
  });

  it("accepts kills confirm pending without proposedBreakdown", () => {
    expect(
      isKillsConfirmPending({
        kind: "anomaly_confirm",
        proposedTotal: 150_000_000,
        commanderId: "cmd-1",
      }),
    ).toBe(true);
  });

  it("rejects THP pending mistaken for kills", () => {
    expect(
      isKillsConfirmPending({
        kind: "anomaly_confirm",
        proposedTotal: 150_000_000,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBe(false);
  });

  it("rejects VR anomaly pending mistaken for THP", () => {
    expect(
      isThpConfirmPending({
        kind: "anomaly_confirm",
        proposedVr: 4200,
        ashedMemberId: "member-1",
      }),
    ).toBe(false);
  });

  it("accepts VR anomaly pending with proposedVr", () => {
    expect(
      isVrAnomalyConfirmPending({
        kind: "anomaly_confirm",
        proposedVr: 4200,
        ashedMemberId: "member-1",
      }),
    ).toBe(true);
  });

  it("rejects THP anomaly pending mistaken for VR", () => {
    expect(
      isVrAnomalyConfirmPending({
        kind: "anomaly_confirm",
        proposedTotal: 150_000_000,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBe(false);
  });

  it("maps ocr confirm pending to screenshot source", () => {
    expect(
      thpConfirmEventSource({
        kind: "ocr_confirm",
        proposedTotal: 1,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBe("screenshot_ocr");
  });
});

describe("processThpConfirmation", () => {
  it("does not throw when pending shape matches VR anomaly confirm", () => {
    const result = processThpConfirmation({
      answer: "yes",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 4200,
        ashedMemberId: "member-1",
      } as never,
      translate,
      peerMax: 100_000_000,
      currentTotal: null,
    });

    expect(result.reply).toBe("errors.noConfirm");
    expect(result.action.type).toBe("none");
  });
});
