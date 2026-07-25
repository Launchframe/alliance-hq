import { describe, expect, it } from "vitest";

import { buildTrainsGuidedVideoUploadHref } from "@/lib/trains/guided-video-upload.shared";

describe("buildTrainsGuidedVideoUploadHref", () => {
  it("presets VS Performance and prior-day recorded date", () => {
    expect(
      buildTrainsGuidedVideoUploadHref({
        trainDate: "2026-07-25",
        vsDataStatus: {
          required: true,
          ready: false,
          scoreCount: 0,
          kind: "prior_day_vs",
          scoreDate: "2026-07-24",
        },
      }),
    ).toBe(
      "/tools/video-upload?scoreTarget=vs-performance&recordedDate=2026-07-24",
    );
  });
});
