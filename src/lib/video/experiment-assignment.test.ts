import { describe, expect, it } from "vitest";

import {
  pickExperimentArm,
  pickExperimentCampaign,
  resolvePrimaryExtractionStamp,
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

describe("resolvePrimaryExtractionStamp", () => {
  const standing = {
    passKey: "scene_0.25",
    configJson: { mode: "scene" as const, sceneThreshold: 0.25, sampleFps: 1 },
  };
  const fps3 = {
    passKey: "fps_3",
    configJson: { mode: "fps" as const, sampleFps: 3 },
  };

  it("uses standing assignment when no experiment applies", () => {
    expect(
      resolvePrimaryExtractionStamp({ standing, experiment: null }),
    ).toEqual({
      passKey: "scene_0.25",
      configJson: standing.configJson,
      experimentCampaignId: null,
      experimentArmId: null,
    });
  });

  it("stamps variant arm extraction config onto the primary", () => {
    expect(
      resolvePrimaryExtractionStamp({
        standing,
        experiment: {
          campaignId: "camp-1",
          armId: "arm-variant",
          configId: "cfg-fps-3",
          armConfig: fps3,
        },
      }),
    ).toEqual({
      passKey: "fps_3",
      configJson: fps3.configJson,
      experimentCampaignId: "camp-1",
      experimentArmId: "arm-variant",
    });
  });

  it("keeps standing config for control arms (null configId)", () => {
    expect(
      resolvePrimaryExtractionStamp({
        standing,
        experiment: {
          campaignId: "camp-1",
          armId: "arm-control",
          configId: null,
          armConfig: null,
        },
      }),
    ).toEqual({
      passKey: "scene_0.25",
      configJson: standing.configJson,
      experimentCampaignId: "camp-1",
      experimentArmId: "arm-control",
    });
  });

  it("ignores roster-ocr arm configs for primary frame extraction", () => {
    expect(
      resolvePrimaryExtractionStamp({
        standing,
        experiment: {
          campaignId: "camp-1",
          armId: "arm-roster",
          configId: "cfg-roster",
          armConfig: {
            passKey: "roster_ocr_scale_2_psm_6",
            configJson: { mode: "roster-ocr", preprocessScale: 2, tesseractPsm: 6 },
          },
        },
      }),
    ).toEqual({
      passKey: "scene_0.25",
      configJson: standing.configJson,
      experimentCampaignId: "camp-1",
      experimentArmId: "arm-roster",
    });
  });
});
