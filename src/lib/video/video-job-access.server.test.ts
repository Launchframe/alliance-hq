import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSession = vi.hoisted(() => vi.fn());
const sessionCanAccessAllianceVideoJob = vi.hoisted(() => vi.fn());
const sessionCanProcessVideoForAlliance = vi.hoisted(() => vi.fn());

const selectLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  loadSession,
}));

vi.mock("@/lib/video/processor-slots.server", () => ({
  sessionCanAccessAllianceVideoJob,
  sessionCanProcessVideoForAlliance,
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
    videoUploadGroups: {
      id: "id",
      primaryJobId: "primaryJobId",
      sessionId: "sessionId",
      allianceId: "allianceId",
    },
  },
}));

import { resolveVideoJobAccess, resolveVideoUploadGroupAccess } from "@/lib/video/video-job-access.server";

const baseJob = {
  id: "job-1",
  sessionId: "uploader-session",
  allianceId: "alliance-a",
  enqueuedByHqUserId: "officer-hq-user",
  status: "review",
};

describe("resolveVideoJobAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([baseJob]);
    sessionCanAccessAllianceVideoJob.mockResolvedValue(true);
    sessionCanProcessVideoForAlliance.mockResolvedValue(true);
    loadSession.mockResolvedValue({
      id: "laptop-session",
      currentAllianceId: null,
      hqUserId: "owner-hq-user",
    });
  });

  it("allows alliance access without matching session.currentAllianceId", async () => {
    const result = await resolveVideoJobAccess(
      "job-1",
      "laptop-session",
      "read",
    );

    expect(result.ok).toBe(true);
    expect(sessionCanAccessAllianceVideoJob).toHaveBeenCalledWith(
      "laptop-session",
      "alliance-a",
      { enqueuedByHqUserId: "officer-hq-user" },
    );
  });

  it("denies when alliance access check fails with 404", async () => {
    sessionCanAccessAllianceVideoJob.mockResolvedValue(false);

    const result = await resolveVideoJobAccess(
      "job-1",
      "laptop-session",
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
    expect(sessionCanAccessAllianceVideoJob).not.toHaveBeenCalled();
  });

  it("requires process permission for the job alliance", async () => {
    sessionCanProcessVideoForAlliance.mockResolvedValue(false);

    const result = await resolveVideoJobAccess(
      "job-1",
      "laptop-session",
      "process",
    );

    expect(result).toEqual({ ok: false, status: 403 });
    expect(sessionCanProcessVideoForAlliance).toHaveBeenCalledWith(
      "laptop-session",
      "alliance-a",
    );
  });

  it("allows uploader session without alliance access check", async () => {
    sessionCanAccessAllianceVideoJob.mockResolvedValue(false);
    loadSession.mockResolvedValue({
      id: "uploader-session",
      currentAllianceId: "alliance-a",
    });

    const result = await resolveVideoJobAccess(
      "job-1",
      "uploader-session",
      "mutate",
    );

    expect(result.ok).toBe(true);
    expect(sessionCanAccessAllianceVideoJob).not.toHaveBeenCalled();
  });

  it("allows enqueuing HQ user on a new session without uploader cookie match", async () => {
    sessionCanAccessAllianceVideoJob.mockResolvedValue(false);
    loadSession.mockResolvedValue({
      id: "new-mobile-session",
      currentAllianceId: null,
      hqUserId: "officer-hq-user",
    });

    const result = await resolveVideoJobAccess(
      "job-1",
      "new-mobile-session",
      "read",
    );

    expect(result.ok).toBe(true);
    expect(sessionCanAccessAllianceVideoJob).not.toHaveBeenCalled();
  });
});

describe("resolveVideoUploadGroupAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionCanAccessAllianceVideoJob.mockResolvedValue(true);
    sessionCanProcessVideoForAlliance.mockResolvedValue(true);
  });

  it("delegates to primary job access for cross-device reviewers", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          id: "group-1",
          primaryJobId: "job-1",
          sessionId: "uploader-session",
          allianceId: "alliance-a",
        },
      ])
      .mockResolvedValueOnce([baseJob]);
    loadSession.mockResolvedValue({
      id: "laptop-session",
      currentAllianceId: "alliance-a",
    });

    const result = await resolveVideoUploadGroupAccess(
      "group-1",
      "laptop-session",
      "mutate",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.group.id).toBe("group-1");
    }
  });

  it("returns 404 when group is missing", async () => {
    selectLimit.mockResolvedValueOnce([]);

    const result = await resolveVideoUploadGroupAccess(
      "missing-group",
      "laptop-session",
      "mutate",
    );

    expect(result).toEqual({ ok: false, status: 404 });
  });
});
