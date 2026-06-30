import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSession = vi.hoisted(() => vi.fn());
const sessionCanReadAllianceVideoQueue = vi.hoisted(() => vi.fn());
const sessionCanProcessVideo = vi.hoisted(() => vi.fn());

const selectLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  loadSession,
}));

vi.mock("@/lib/video/processor-slots.server", () => ({
  sessionCanReadAllianceVideoQueue,
  sessionCanProcessVideo,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "id",
    },
  },
}));

import { resolveVideoJobAccess } from "@/lib/video/video-job-access.server";

const baseJob = {
  id: "job-1",
  sessionId: "uploader-session",
  allianceId: "alliance-a",
  status: "review",
};

describe("resolveVideoJobAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([baseJob]);
    sessionCanReadAllianceVideoQueue.mockResolvedValue(true);
    sessionCanProcessVideo.mockResolvedValue(true);
  });

  it("allows same-alliance queue reader to read a job from another session", async () => {
    loadSession.mockResolvedValue({
      id: "laptop-session",
      currentAllianceId: "alliance-a",
    });

    const result = await resolveVideoJobAccess(
      "job-1",
      "laptop-session",
      "read",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.id).toBe("job-1");
    }
  });

  it("denies cross-alliance access with 404", async () => {
    loadSession.mockResolvedValue({
      id: "other-session",
      currentAllianceId: "alliance-b",
    });

    const result = await resolveVideoJobAccess(
      "job-1",
      "other-session",
      "read",
    );

    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("allows uploader session for legacy jobs without alliance", async () => {
    selectLimit.mockResolvedValue([{ ...baseJob, allianceId: null }]);
    loadSession.mockResolvedValue({
      id: "uploader-session",
      currentAllianceId: null,
    });

    const result = await resolveVideoJobAccess(
      "job-1",
      "uploader-session",
      "read",
    );

    expect(result.ok).toBe(true);
  });

  it("requires process permission for process level", async () => {
    loadSession.mockResolvedValue({
      id: "laptop-session",
      currentAllianceId: "alliance-a",
    });
    sessionCanProcessVideo.mockResolvedValue(false);

    const result = await resolveVideoJobAccess(
      "job-1",
      "laptop-session",
      "process",
    );

    expect(result).toEqual({ ok: false, status: 403 });
  });
});
