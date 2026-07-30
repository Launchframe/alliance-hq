import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  siblings: [] as Array<{
    storageKey: string | null;
    archiveStorageKey: string | null;
    status: string;
  }>,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => mockState.siblings),
    })),
  })),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...clauses: unknown[]) => clauses),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ left, right, op: "ne" })),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  schema: {
    videoJobs: {
      id: "videoJobs.id",
      groupId: "videoJobs.groupId",
      storageKey: "videoJobs.storageKey",
      archiveStorageKey: "videoJobs.archiveStorageKey",
      status: "videoJobs.status",
    },
  },
}));

import {
  filterJobStorageKeysSafeToDelete,
  sourceStillNeededByGroupSiblings,
} from "@/lib/video/shared-job-storage.server";

beforeEach(() => {
  mockState.siblings = [];
  mockDb.select.mockClear();
});

describe("sourceStillNeededByGroupSiblings", () => {
  it("is false when the job has no upload group", async () => {
    await expect(
      sourceStillNeededByGroupSiblings({
        jobId: "primary",
        groupId: null,
        sourceKey: "videos/shared.mp4",
      }),
    ).resolves.toBe(false);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("is true when a living sibling still shares the source without an archive", async () => {
    mockState.siblings = [
      {
        storageKey: "videos/shared.mp4",
        archiveStorageKey: null,
        status: "review",
      },
    ];
    await expect(
      sourceStillNeededByGroupSiblings({
        jobId: "primary",
        groupId: "g1",
        sourceKey: "videos/shared.mp4",
      }),
    ).resolves.toBe(true);
  });

  it("ignores discarded siblings and archived siblings", async () => {
    mockState.siblings = [
      {
        storageKey: "videos/shared.mp4",
        archiveStorageKey: null,
        status: "discarded",
      },
      {
        storageKey: "videos/shared.mp4",
        archiveStorageKey: "archives/shadow.mp4",
        status: "complete",
      },
    ];
    await expect(
      sourceStillNeededByGroupSiblings({
        jobId: "primary",
        groupId: "g1",
        sourceKey: "videos/shared.mp4",
      }),
    ).resolves.toBe(false);
  });
});

describe("filterJobStorageKeysSafeToDelete", () => {
  it("keeps the shared source when a shadow sibling still needs it", async () => {
    mockState.siblings = [
      {
        storageKey: "videos/shared.mp4",
        archiveStorageKey: null,
        status: "review",
      },
    ];
    await expect(
      filterJobStorageKeysSafeToDelete({
        jobId: "primary",
        groupId: "g1",
        storageKey: "videos/shared.mp4",
        archiveStorageKey: "archives/primary.mp4",
      }),
    ).resolves.toEqual(["archives/primary.mp4"]);
  });

  it("deletes the source when no living sibling needs it", async () => {
    mockState.siblings = [
      {
        storageKey: "videos/shared.mp4",
        archiveStorageKey: null,
        status: "discarded",
      },
    ];
    await expect(
      filterJobStorageKeysSafeToDelete({
        jobId: "shadow",
        groupId: "g1",
        storageKey: "videos/shared.mp4",
        archiveStorageKey: null,
      }),
    ).resolves.toEqual(["videos/shared.mp4"]);
  });
});
