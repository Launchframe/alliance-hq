import { describe, expect, it } from "vitest";

import { peerMaxExcludingCommander } from "@/lib/vr/anomaly";
import { parseStoredVrPending } from "@/lib/vr/pending-state";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";

const translate = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("commander-scoped VR pending + command", () => {
  it("writes commanderId into anomaly pending and set_vr action", () => {
    const result = processVrCommand({
      explicitLevel: 9000,
      seasonHigh: 1000,
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
      pending: null,
      reporterCount: 5,
      peerMax: 2000,
      translate,
      seasonKey: "5",
    });

    if (result.needsConfirmation) {
      expect(result.pending).toMatchObject({
        kind: "anomaly_confirm",
        ashedMemberId: "member-1",
        commanderId: "cmd-1",
      });
      return;
    }

    expect(result.action).toMatchObject({
      type: "set_vr",
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
    });
  });

  it("preserves commanderId through confirmation", () => {
    const result = processVrConfirmation({
      answer: "yes",
      pending: {
        kind: "anomaly_confirm",
        proposedVr: 4200,
        ashedMemberId: "member-1",
        commanderId: "cmd-1",
      },
      translate,
      seasonKey: "5",
    });

    expect(result.action).toEqual({
      type: "set_vr",
      vr: 4200,
      ashedMemberId: "member-1",
      commanderId: "cmd-1",
    });
  });

  it("parses legacy pending without commanderId", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedVr: 3000,
        ashedMemberId: "m1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedVr: 3000,
      ashedMemberId: "m1",
    });
  });
});

describe("peerMaxExcludingCommander", () => {
  it("excludes the target commander from peer max", () => {
    expect(
      peerMaxExcludingCommander(
        [
          { commanderId: "a", highestBaseVr: 1000 },
          { commanderId: "b", highestBaseVr: 5000 },
          { commanderId: "c", highestBaseVr: 3000 },
        ],
        "b",
      ),
    ).toBe(3000);
  });
});
