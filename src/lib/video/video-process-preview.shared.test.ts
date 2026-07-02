import { describe, expect, it } from "vitest";

import { buildVideoProcessShadowFollowups } from "@/lib/video/video-process-preview.shared";

describe("buildVideoProcessShadowFollowups", () => {
  it("returns no followups for in-house native primary", () => {
    expect(
      buildVideoProcessShadowFollowups({
        primaryEngine: "native",
        isRosterTarget: true,
        experimentArmConfigId: null,
        hasExperimentAssignment: false,
      }),
    ).toEqual([]);
  });

  it("includes extraction and tesseract shadows for ashed roster jobs", () => {
    expect(
      buildVideoProcessShadowFollowups({
        primaryEngine: "ashed",
        isRosterTarget: true,
        experimentArmConfigId: null,
        hasExperimentAssignment: false,
      }),
    ).toEqual([
      { kind: "extraction_shadow", conditional: true },
      { kind: "tesseract_shadow", conditional: false },
    ]);
  });

  it("skips extraction shadow for control experiment arms without config", () => {
    expect(
      buildVideoProcessShadowFollowups({
        primaryEngine: "ashed",
        isRosterTarget: true,
        experimentArmConfigId: null,
        hasExperimentAssignment: true,
      }),
    ).toEqual([{ kind: "tesseract_shadow", conditional: false }]);
  });
});
