import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  selectResults: [] as unknown[][],
  insertedValues: null as Record<string, unknown> | null,
};

vi.mock("nanoid", () => ({
  nanoid: () => "tesseract-shadow-job-id",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mockState.selectResults.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        mockState.insertedValues = values;
      },
    }),
  }),
  schema: {
    videoJobs: {
      id: "videoJobs.id",
      groupId: "videoJobs.groupId",
      passRole: "videoJobs.passRole",
    },
  },
}));

vi.mock("@/lib/members/roster-ocr/assign-roster-config", () => ({
  assignRosterOcrExperiment: vi.fn(async () => ({
    config: {
      mode: "roster-ocr",
      preprocessScale: 2,
      tesseractPsm: 6,
    },
    passKey: "roster_ocr_scale_2_psm_6",
  })),
  resolveRosterOcrConfigForVideoGroup: vi.fn(async () => ({
    config: {
      mode: "roster-ocr",
      preprocessScale: 2,
      tesseractPsm: 6,
    },
    passKey: "roster_ocr_scale_2_psm_6",
    experimentCampaignId: null,
    experimentArmId: null,
  })),
}));

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: vi.fn(() => Promise.resolve()),
}));

import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";
import {
  isTesseractShadowEligible,
  maybeEnqueueTesseractShadowPass,
} from "@/lib/video/enqueue-tesseract-shadow-pass";

const baseJob = {
  id: "primary-job",
  sessionId: "session-1",
  allianceId: "alliance-1",
  scoreTarget: "member-roster-video",
  category: null,
  storageKey: "videos/primary.mp4",
  boardKey: null,
  hqEventId: null,
  groupId: "group-1",
  passRole: "primary",
  frameCount: 45,
  hqUserId: "user-1",
};

describe("isTesseractShadowEligible", () => {
  it("allows roster video primary jobs regardless of frame count", () => {
    expect(
      isTesseractShadowEligible({
        scoreTarget: "member-roster-video",
        category: null,
        passRole: "primary",
      }),
    ).toEqual({ eligible: true, reason: "eligible" });
  });

  it("rejects non-roster score targets", () => {
    expect(
      isTesseractShadowEligible({
        scoreTarget: "desert-storm",
        category: null,
        passRole: "primary",
      }),
    ).toEqual({ eligible: false, reason: "not_roster_video" });
  });

  it("rejects non-primary pass roles", () => {
    expect(
      isTesseractShadowEligible({
        scoreTarget: "member-roster-video",
        category: null,
        passRole: "tesseract_shadow",
      }),
    ).toEqual({ eligible: false, reason: "not_primary" });
  });
});

describe("maybeEnqueueTesseractShadowPass", () => {
  beforeEach(() => {
    mockState.selectResults = [[]];
    mockState.insertedValues = null;
    vi.clearAllMocks();
  });

  it("inserts tesseract shadow job and dispatches for roster primary jobs", async () => {
    await maybeEnqueueTesseractShadowPass({ job: baseJob });

    expect(mockState.insertedValues).toMatchObject({
      id: "tesseract-shadow-job-id",
      passRole: "tesseract_shadow",
      passKey: "roster_ocr_scale_2_psm_6",
      groupId: "group-1",
      frameCount: 45,
      uploadedFrameCount: 45,
      status: "queued",
    });
    expect(dispatchVideoProcessing).toHaveBeenCalledWith(
      "tesseract-shadow-job-id",
      { source: "tesseract_shadow_pass" },
    );
  });

  it("skips insert when a tesseract shadow job already exists", async () => {
    mockState.selectResults = [[{ id: "existing-shadow" }]];

    await maybeEnqueueTesseractShadowPass({ job: baseJob });

    expect(mockState.insertedValues).toBeNull();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("skips when groupId is missing", async () => {
    await maybeEnqueueTesseractShadowPass({
      job: { ...baseJob, groupId: null },
    });

    expect(mockState.insertedValues).toBeNull();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });
});
