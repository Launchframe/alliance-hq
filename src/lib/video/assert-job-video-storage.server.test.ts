import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveJobVideoStorageKey = vi.fn();
const getObjectSize = vi.fn();

vi.mock("@/lib/video/resolve-job-video-storage", () => ({
  resolveJobVideoStorageKey: (...args: unknown[]) =>
    resolveJobVideoStorageKey(...args),
}));

vi.mock("@/lib/storage", () => ({
  getObjectSize: (...args: unknown[]) => getObjectSize(...args),
}));

import {
  assertJobVideoStorageAvailable,
} from "./assert-job-video-storage.server";

const JOB = {
  storageKey: "videos/shadow/source.mp4",
  archiveStorageKey: null,
  groupId: "group-1",
  fileName: "clip.mp4",
};

describe("assertJobVideoStorageAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the resolved key when the object exists", async () => {
    resolveJobVideoStorageKey.mockResolvedValue("videos/primary/archive.mp4");
    getObjectSize.mockResolvedValue(1024);

    await expect(assertJobVideoStorageAvailable(JOB)).resolves.toBe(
      "videos/primary/archive.mp4",
    );
    expect(getObjectSize).toHaveBeenCalledWith("videos/primary/archive.mp4");
  });

  it("throws 404 when no storage key resolves", async () => {
    resolveJobVideoStorageKey.mockResolvedValue(null);

    await expect(assertJobVideoStorageAvailable(JOB)).rejects.toMatchObject({
      name: "VideoJobStorageUnavailableError",
      message: "Job has no stored video.",
      statusCode: 404,
    });
    expect(getObjectSize).not.toHaveBeenCalled();
  });

  it("throws 404 before reprocess when the resolved object is missing", async () => {
    resolveJobVideoStorageKey.mockResolvedValue("videos/shadow/source.mp4");
    getObjectSize.mockRejectedValue(new Error("NoSuchKey"));

    await expect(assertJobVideoStorageAvailable(JOB)).rejects.toMatchObject({
      name: "VideoJobStorageUnavailableError",
      message:
        "The source video is no longer in storage. Reprocess the primary pass or re-upload the clip.",
      statusCode: 404,
    });
  });
});
