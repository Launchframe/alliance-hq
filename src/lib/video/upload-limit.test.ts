import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_VIDEO_UPLOAD_BYTES,
  getMaxVideoUploadBytes,
  isVideoUploadOverLimit,
  isVideoUploadSizeLimitEnforced,
} from "./upload-limit";

describe("upload-limit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enforces the 4 MB cap in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isVideoUploadSizeLimitEnforced()).toBe(true);
    expect(getMaxVideoUploadBytes()).toBe(MAX_VIDEO_UPLOAD_BYTES);
    expect(isVideoUploadOverLimit(MAX_VIDEO_UPLOAD_BYTES)).toBe(false);
    expect(isVideoUploadOverLimit(MAX_VIDEO_UPLOAD_BYTES + 1)).toBe(true);
  });

  it("skips the cap in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isVideoUploadSizeLimitEnforced()).toBe(false);
    expect(getMaxVideoUploadBytes()).toBeNull();
    expect(isVideoUploadOverLimit(MAX_VIDEO_UPLOAD_BYTES + 1)).toBe(false);
  });
});
