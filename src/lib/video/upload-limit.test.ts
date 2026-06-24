import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_VIDEO_UPLOAD_BYTES,
  getMaxVideoUploadBytes,
  isLegacyDirectPostOverLimit,
  isVideoUploadOverLimit,
  LEGACY_DIRECT_POST_MAX_BYTES,
  multipartPartCount,
  MULTIPART_PART_BYTES,
} from "./upload-limit";

describe("upload-limit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 512 MiB when VIDEO_MAX_UPLOAD_BYTES is unset", () => {
    expect(getMaxVideoUploadBytes()).toBe(DEFAULT_MAX_VIDEO_UPLOAD_BYTES);
    expect(isVideoUploadOverLimit(DEFAULT_MAX_VIDEO_UPLOAD_BYTES)).toBe(false);
    expect(isVideoUploadOverLimit(DEFAULT_MAX_VIDEO_UPLOAD_BYTES + 1)).toBe(true);
  });

  it("respects VIDEO_MAX_UPLOAD_BYTES env override", () => {
    vi.stubEnv("VIDEO_MAX_UPLOAD_BYTES", "1048576");
    expect(getMaxVideoUploadBytes()).toBe(1048576);
    expect(isVideoUploadOverLimit(1048577)).toBe(true);
  });

  it("enforces legacy 4 MB direct POST cap in production only", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isLegacyDirectPostOverLimit(LEGACY_DIRECT_POST_MAX_BYTES)).toBe(false);
    expect(isLegacyDirectPostOverLimit(LEGACY_DIRECT_POST_MAX_BYTES + 1)).toBe(true);
  });

  it("skips legacy direct POST cap in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isLegacyDirectPostOverLimit(LEGACY_DIRECT_POST_MAX_BYTES + 1)).toBe(
      false,
    );
  });

  it("computes multipart part count", () => {
    expect(multipartPartCount(MULTIPART_PART_BYTES)).toBe(1);
    expect(multipartPartCount(MULTIPART_PART_BYTES + 1)).toBe(2);
  });
});
