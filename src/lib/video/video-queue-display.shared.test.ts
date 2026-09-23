import { describe, expect, it } from "vitest";

import {
  videoQueueFrameProgress,
  videoQueueTargetLabelKey,
} from "./video-queue-display.shared";

describe("videoQueueTargetLabelKey", () => {
  it("maps known score targets to compact i18n keys", () => {
    expect(videoQueueTargetLabelKey("vs-performance")).toBe("vsPerformance");
    expect(videoQueueTargetLabelKey("member-roster-video")).toBe(
      "memberRosterVideo",
    );
    expect(videoQueueTargetLabelKey("alliance-kills-video")).toBe(
      "allianceKillsVideo",
    );
    expect(videoQueueTargetLabelKey("alliance-star")).toBe("allianceStar");
    expect(videoQueueTargetLabelKey("bank-deposit-slip-history")).toBe(
      "bankDepositSlipHistory",
    );
  });

  it("returns null for missing or unknown ids", () => {
    expect(videoQueueTargetLabelKey(null)).toBeNull();
    expect(videoQueueTargetLabelKey("not-a-target")).toBeNull();
  });
});

describe("videoQueueFrameProgress", () => {
  it("shows uploaded/total frames while uploading or processing", () => {
    expect(
      videoQueueFrameProgress({
        status: "pending_upload",
        uploadedFrameCount: 3,
        frameCount: 10,
      }),
    ).toBe("3/10");
    expect(
      videoQueueFrameProgress({
        status: "extracting",
        uploadedFrameCount: 2,
        frameCount: 8,
      }),
    ).toBe("2/8");
  });

  it("does not put failure copy in the inline progress slot", () => {
    expect(
      videoQueueFrameProgress({
        status: "failed",
        uploadedFrameCount: 3,
        frameCount: 10,
      }),
    ).toBeNull();
  });
});
