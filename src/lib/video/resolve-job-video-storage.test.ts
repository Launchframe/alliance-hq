import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  primaryArchive: null as string | null,
  groupStorageKey: null as string | null,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            mockState.primaryArchive
              ? [{ archiveStorageKey: mockState.primaryArchive }]
              : [],
          ),
        })),
      })),
      where: vi.fn(() => ({
        limit: vi.fn(async () =>
          mockState.groupStorageKey
            ? [{ storageKey: mockState.groupStorageKey }]
            : [],
        ),
      })),
    })),
  })),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  schema: {
    videoUploadGroups: {
      id: "videoUploadGroups.id",
      primaryJobId: "videoUploadGroups.primaryJobId",
      storageKey: "videoUploadGroups.storageKey",
    },
    videoJobs: {
      id: "videoJobs.id",
      archiveStorageKey: "videoJobs.archiveStorageKey",
    },
  },
}));

import { resolveJobVideoStorageKey } from "./resolve-job-video-storage";

describe("resolveJobVideoStorageKey", () => {
  beforeEach(() => {
    mockState.primaryArchive = null;
    mockState.groupStorageKey = null;
    mockDb.select.mockClear();
  });

  it("prefers archive key over source key", async () => {
    const key = await resolveJobVideoStorageKey({
      storageKey: "videos/job-1/source.mp4",
      archiveStorageKey: "videos/job-1/archive.mp4",
      groupId: null,
      fileName: "clip.mp4",
    });
    expect(key).toBe("videos/job-1/archive.mp4");
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("falls back to source key when no archive", async () => {
    const key = await resolveJobVideoStorageKey({
      storageKey: "videos/job-1/source.mp4",
      archiveStorageKey: null,
      groupId: null,
      fileName: "clip.mp4",
    });
    expect(key).toBe("videos/job-1/source.mp4");
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("uses primary archive for shadow siblings when shared source was deleted", async () => {
    mockState.primaryArchive = "videos/primary/archive.mp4";

    const key = await resolveJobVideoStorageKey({
      storageKey: "videos/primary/source.mp4",
      archiveStorageKey: null,
      groupId: "group-1",
      fileName: null,
    });

    expect(key).toBe("videos/primary/archive.mp4");
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("keeps shared source when primary has not archived yet", async () => {
    const key = await resolveJobVideoStorageKey({
      storageKey: "videos/primary/source.mp4",
      archiveStorageKey: null,
      groupId: "group-1",
      fileName: null,
    });

    expect(key).toBe("videos/primary/source.mp4");
  });
});
