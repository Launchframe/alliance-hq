import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReturning = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return {
        set: (payload: unknown) => {
          mockSet(payload);
          return {
            where: (condition: unknown) => {
              mockWhere(condition);
              return {
                returning: (...retArgs: unknown[]) =>
                  mockReturning(...retArgs),
              };
            },
          };
        },
      };
    },
  }),
  schema: {
    videoJobs: {
      id: "video_jobs.id",
      status: "video_jobs.status",
    },
  },
}));

describe("claimVideoJobForProcessing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns claimed when the CAS update wins queued|failed → extracting", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "job-1" }]);
    const { claimVideoJobForProcessing } = await import(
      "./claim-video-job-for-processing.server"
    );

    await expect(claimVideoJobForProcessing("job-1")).resolves.toBe("claimed");
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "extracting",
        errorMessage: null,
      }),
    );
  });

  it("returns lost_race when another worker already claimed the job", async () => {
    mockReturning.mockResolvedValueOnce([]);
    const { claimVideoJobForProcessing } = await import(
      "./claim-video-job-for-processing.server"
    );

    await expect(claimVideoJobForProcessing("job-1")).resolves.toBe(
      "lost_race",
    );
  });
});
