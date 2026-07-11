import { describe, expect, it } from "vitest";

import {
  isVideoJobAllianceStale,
  VIDEO_JOB_ALLIANCE_UNRESOLVED_CODE,
  VIDEO_JOB_ALLIANCE_UNRESOLVED_ERROR,
} from "./video-job-alliance.shared";

describe("isVideoJobAllianceStale", () => {
  it("is false when either side is missing or there is no parse session", () => {
    expect(
      isVideoJobAllianceStale({
        jobHqAllianceId: "hq-1",
        sessionCurrentAllianceId: "hq-2",
        hasParseSession: false,
      }),
    ).toBe(false);
    expect(
      isVideoJobAllianceStale({
        jobHqAllianceId: null,
        sessionCurrentAllianceId: "hq-1",
        hasParseSession: true,
      }),
    ).toBe(false);
    expect(
      isVideoJobAllianceStale({
        jobHqAllianceId: "hq-1",
        sessionCurrentAllianceId: null,
        hasParseSession: true,
      }),
    ).toBe(false);
  });

  it("compares HQ ids only", () => {
    expect(
      isVideoJobAllianceStale({
        jobHqAllianceId: "hq-1",
        sessionCurrentAllianceId: "hq-1",
        hasParseSession: true,
      }),
    ).toBe(false);
    expect(
      isVideoJobAllianceStale({
        jobHqAllianceId: "hq-1",
        sessionCurrentAllianceId: "hq-2",
        hasParseSession: true,
      }),
    ).toBe(true);
  });
});

describe("video job alliance unresolved copy", () => {
  it("keeps a stable code and refresh hint", () => {
    expect(VIDEO_JOB_ALLIANCE_UNRESOLVED_CODE).toBe("job_alliance_unresolved");
    expect(VIDEO_JOB_ALLIANCE_UNRESOLVED_ERROR).toContain("refresh the page");
  });
});
