import { describe, expect, it } from "vitest";

import {
  buildTrainsGuidedVideoUploadHref,
  buildTrainsScoresReadyReturnPath,
  parseTrainsHubDateParam,
  parseTrainsScoresReadyParam,
} from "@/lib/trains/guided-video-upload.shared";

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

  it("prefers explicit scoreDate and appends trains returnTo", () => {
    const href = buildTrainsGuidedVideoUploadHref({
      trainDate: "2026-07-25",
      scoreDate: "2026-07-20",
      leadDays: 4,
      returnTo: true,
    });
    expect(href).toContain("scoreTarget=vs-performance");
    expect(href).toContain("recordedDate=2026-07-20");
    expect(href).toContain(
      `returnTo=${encodeURIComponent("/trains?date=2026-07-25&scoresReady=1")}`,
    );
  });

  it("derives scoreDate from leadDays when status is missing", () => {
    expect(
      buildTrainsGuidedVideoUploadHref({
        trainDate: "2026-07-25",
        leadDays: 1,
      }),
    ).toBe(
      "/tools/video-upload?scoreTarget=vs-performance&recordedDate=2026-07-23",
    );
  });
});

describe("trains hub return params", () => {
  it("builds and parses date + scoresReady", () => {
    expect(buildTrainsScoresReadyReturnPath("2026-07-25")).toBe(
      "/trains?date=2026-07-25&scoresReady=1",
    );
    expect(parseTrainsHubDateParam("2026-07-25")).toBe("2026-07-25");
    expect(parseTrainsHubDateParam("nope")).toBeNull();
    expect(parseTrainsScoresReadyParam("1")).toBe(true);
    expect(parseTrainsScoresReadyParam("0")).toBe(false);
  });
});
