import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRIMARY_PASS } from "./pass-definitions";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  schema: {
    videoHygieneEvents: {
      kind: "kind",
      hqUserId: "hqUserId",
      scoreTarget: "scoreTarget",
      createdAt: "createdAt",
    },
  },
}));

const loadUploaderScoreTargetRewards = vi.fn();
const recordVideoHygieneEvent = vi.fn();

vi.mock("@/lib/video/video-hygiene-instrumentation.server", () => ({
  loadUploaderScoreTargetRewards: (...args: unknown[]) =>
    loadUploaderScoreTargetRewards(...args),
  recordVideoHygieneEvent: (...args: unknown[]) =>
    recordVideoHygieneEvent(...args),
}));

describe("resolveAdaptedPrimaryExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([{ kind: "adapt_bias_on" }]);
    loadUploaderScoreTargetRewards.mockResolvedValue([
      {
        hqUserId: "user-1",
        scoreTarget: "desert-storm",
        jobCount: 5,
        thumbsUpRate: 0.2,
        avgQualityScore: 0.3,
        scrollStyleCounts: { chaotic: 3 },
      },
    ]);
    recordVideoHygieneEvent.mockResolvedValue("evt-1");
  });

  it("does not emit adapt_arm_change on every enqueue while bias stays on", async () => {
    const { resolveAdaptedPrimaryExtraction } = await import(
      "./video-hygiene-adapt.server"
    );

    await resolveAdaptedPrimaryExtraction({
      hqUserId: "user-1",
      scoreTarget: "desert-storm",
      allianceId: "ally-1",
      jobId: "job-2",
      primary: {
        passKey: "scene_0.25",
        configJson: DEFAULT_PRIMARY_PASS,
      },
    });

    expect(recordVideoHygieneEvent).not.toHaveBeenCalled();
  });

  it("emits adapt_bias_on and adapt_arm_change only when bias first turns on", async () => {
    mockLimit.mockResolvedValue([]);
    const { resolveAdaptedPrimaryExtraction } = await import(
      "./video-hygiene-adapt.server"
    );

    await resolveAdaptedPrimaryExtraction({
      hqUserId: "user-1",
      scoreTarget: "desert-storm",
      allianceId: "ally-1",
      jobId: "job-1",
      primary: {
        passKey: "scene_0.25",
        configJson: DEFAULT_PRIMARY_PASS,
      },
    });

    expect(recordVideoHygieneEvent).toHaveBeenCalledTimes(2);
    expect(recordVideoHygieneEvent.mock.calls[0]?.[0]).toMatchObject({
      kind: "adapt_bias_on",
    });
    expect(recordVideoHygieneEvent.mock.calls[1]?.[0]).toMatchObject({
      kind: "adapt_arm_change",
    });
  });
});
