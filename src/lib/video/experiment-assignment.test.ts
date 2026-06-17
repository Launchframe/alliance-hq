import { describe, expect, it } from "vitest";

import {
  pickExperimentArm,
  pickExperimentCampaign,
} from "@/lib/video/experiment-assignment";

describe("pickExperimentCampaign", () => {
  it("prefers a board-specific campaign over a global fallback", () => {
    const globalCampaign = {
      id: "global",
      boardKey: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      trafficPercent: 100,
    };
    const boardCampaign = {
      id: "board",
      boardKey: "kills",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      trafficPercent: 100,
    };

    expect(
      pickExperimentCampaign([globalCampaign, boardCampaign], "kills")?.id,
    ).toBe("board");
  });

  it("uses the oldest matching campaign when scopes tie", () => {
    const olderCampaign = {
      id: "older",
      boardKey: "kills",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      trafficPercent: 100,
    };
    const newerCampaign = {
      id: "newer",
      boardKey: "kills",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      trafficPercent: 100,
    };

    expect(
      pickExperimentCampaign([newerCampaign, olderCampaign], "kills")?.id,
    ).toBe("older");
  });
});

describe("pickExperimentArm", () => {
  it("assigns by relative positive traffic weights", () => {
    const arms = [
      { id: "control", trafficWeight: 1 },
      { id: "variant", trafficWeight: 3 },
    ];

    expect(pickExperimentArm(arms, 0.1)?.id).toBe("control");
    expect(pickExperimentArm(arms, 0.5)?.id).toBe("variant");
  });

  it("ignores zero and negative weights", () => {
    const arms = [
      { id: "invalid", trafficWeight: -10 },
      { id: "zero", trafficWeight: 0 },
      { id: "valid", trafficWeight: 5 },
    ];

    expect(pickExperimentArm(arms, 0)?.id).toBe("valid");
  });
});
