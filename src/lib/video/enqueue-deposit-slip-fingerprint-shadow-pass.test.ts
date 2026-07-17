import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  selectResults: [] as unknown[][],
  insertedValues: null as Record<string, unknown> | null,
};

vi.mock("nanoid", () => ({
  nanoid: () => "deposit-slip-fingerprint-shadow-job-id",
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

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing: vi.fn(() => Promise.resolve()),
}));

import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";
import {
  isDepositSlipFingerprintShadowEligible,
  maybeEnqueueDepositSlipFingerprintShadowPass,
} from "@/lib/video/enqueue-deposit-slip-fingerprint-shadow-pass";

const baseJob = {
  id: "primary-job",
  sessionId: "session-1",
  allianceId: "alliance-1",
  scoreTarget: "bank-deposit-slip-history",
  category: null,
  storageKey: "videos/primary.mp4",
  boardKey: null,
  hqEventId: null,
  groupId: "group-1",
  passRole: "primary",
  frameCount: 90,
  hqUserId: "user-1",
};

describe("isDepositSlipFingerprintShadowEligible", () => {
  it("allows native-engine deposit-slip primary jobs", () => {
    expect(
      isDepositSlipFingerprintShadowEligible({
        scoreTarget: "bank-deposit-slip-history",
        category: null,
        passRole: "primary",
        ocrEngine: "native",
      }),
    ).toEqual({ eligible: true, reason: "eligible" });
  });

  it("rejects non-deposit-slip score targets", () => {
    expect(
      isDepositSlipFingerprintShadowEligible({
        scoreTarget: "member-roster-video",
        category: null,
        passRole: "primary",
        ocrEngine: "native",
      }),
    ).toEqual({ eligible: false, reason: "not_deposit_slip_video" });
  });

  it("rejects non-primary pass roles", () => {
    expect(
      isDepositSlipFingerprintShadowEligible({
        scoreTarget: "bank-deposit-slip-history",
        category: null,
        passRole: "deposit_slip_fingerprint_shadow",
        ocrEngine: "native",
      }),
    ).toEqual({ eligible: false, reason: "not_primary" });
  });

  it("rejects non-native engines (mock has no real frames to fingerprint)", () => {
    expect(
      isDepositSlipFingerprintShadowEligible({
        scoreTarget: "bank-deposit-slip-history",
        category: null,
        passRole: "primary",
        ocrEngine: "mock",
      }),
    ).toEqual({ eligible: false, reason: "not_native_engine" });
    expect(
      isDepositSlipFingerprintShadowEligible({
        scoreTarget: "bank-deposit-slip-history",
        category: null,
        passRole: "primary",
        ocrEngine: "ashed",
      }),
    ).toEqual({ eligible: false, reason: "not_native_engine" });
  });
});

describe("maybeEnqueueDepositSlipFingerprintShadowPass", () => {
  beforeEach(() => {
    mockState.selectResults = [[]];
    mockState.insertedValues = null;
    vi.clearAllMocks();
  });

  it("inserts a fingerprint shadow job and dispatches for native deposit-slip primary jobs", async () => {
    await maybeEnqueueDepositSlipFingerprintShadowPass({
      job: baseJob,
      ocrEngine: "native",
    });

    expect(mockState.insertedValues).toMatchObject({
      id: "deposit-slip-fingerprint-shadow-job-id",
      passRole: "deposit_slip_fingerprint_shadow",
      passKey: "row_fingerprint_v1",
      groupId: "group-1",
      frameCount: 90,
      uploadedFrameCount: 90,
      status: "queued",
    });
    expect(dispatchVideoProcessing).toHaveBeenCalledWith(
      "deposit-slip-fingerprint-shadow-job-id",
      { source: "deposit_slip_fingerprint_shadow_pass" },
    );
  });

  it("skips insert when a fingerprint shadow job already exists for the group", async () => {
    mockState.selectResults = [[{ id: "existing-shadow" }]];

    await maybeEnqueueDepositSlipFingerprintShadowPass({
      job: baseJob,
      ocrEngine: "native",
    });

    expect(mockState.insertedValues).toBeNull();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("skips when groupId is missing", async () => {
    await maybeEnqueueDepositSlipFingerprintShadowPass({
      job: { ...baseJob, groupId: null },
      ocrEngine: "native",
    });

    expect(mockState.insertedValues).toBeNull();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("skips for mock-engine jobs even though the score target matches", async () => {
    await maybeEnqueueDepositSlipFingerprintShadowPass({
      job: baseJob,
      ocrEngine: "mock",
    });

    expect(mockState.insertedValues).toBeNull();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });
});
