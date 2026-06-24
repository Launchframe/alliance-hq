import { describe, expect, it, vi } from "vitest";

import { resolveJobVideoStorageKey } from "./resolve-job-video-storage";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: { videoUploadGroups: {} },
}));

describe("resolveJobVideoStorageKey", () => {
  it("prefers archive key over source key", async () => {
    const key = await resolveJobVideoStorageKey({
      storageKey: "videos/job-1/source.mp4",
      archiveStorageKey: "videos/job-1/archive.mp4",
      groupId: null,
      fileName: "clip.mp4",
    });
    expect(key).toBe("videos/job-1/archive.mp4");
  });

  it("falls back to source key when no archive", async () => {
    const key = await resolveJobVideoStorageKey({
      storageKey: "videos/job-1/source.mp4",
      archiveStorageKey: null,
      groupId: null,
      fileName: "clip.mp4",
    });
    expect(key).toBe("videos/job-1/source.mp4");
  });
});
