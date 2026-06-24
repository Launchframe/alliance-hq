/** Legacy direct POST through Vercel serverless (~4.5 MB body limit). */
export const LEGACY_DIRECT_POST_MAX_BYTES = 4 * 1024 * 1024;

/** Default cap for R2 direct uploads when VIDEO_MAX_UPLOAD_BYTES is unset. */
export const DEFAULT_MAX_VIDEO_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Use multipart presigned uploads at or above this size. */
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 100 * 1024 * 1024;

/** Size of each multipart part (10 MiB). */
export const MULTIPART_PART_BYTES = 10 * 1024 * 1024;

export function getMaxVideoUploadBytes(): number {
  const raw = process.env.VIDEO_MAX_UPLOAD_BYTES?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_VIDEO_UPLOAD_BYTES;
}

export function getMaxVideoUploadMb(): number {
  return Math.round(getMaxVideoUploadBytes() / (1024 * 1024));
}

/** @deprecated use getMaxVideoUploadBytes — kept for tests referencing constant name */
export const MAX_VIDEO_UPLOAD_BYTES = DEFAULT_MAX_VIDEO_UPLOAD_BYTES;

/** @deprecated use getMaxVideoUploadMb */
export const MAX_VIDEO_UPLOAD_MB = Math.round(
  DEFAULT_MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024),
);

/** Direct multipart POST to Next.js (local dev without R2). */
export function isLegacyDirectPostOverLimit(sizeBytes: number): boolean {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  return sizeBytes > LEGACY_DIRECT_POST_MAX_BYTES;
}

/** Enforced for all R2 init/complete uploads. */
export function isVideoUploadOverLimit(sizeBytes: number): boolean {
  return sizeBytes > getMaxVideoUploadBytes();
}

/** @deprecated R2 flow always has a limit; direct POST uses isLegacyDirectPostOverLimit */
export function isVideoUploadSizeLimitEnforced(): boolean {
  return process.env.NODE_ENV === "production";
}

/** @deprecated */
export function getMaxVideoUploadBytesOrNull(): number | null {
  return isVideoUploadSizeLimitEnforced()
    ? LEGACY_DIRECT_POST_MAX_BYTES
    : null;
}

export function multipartPartCount(fileSizeBytes: number): number {
  return Math.max(1, Math.ceil(fileSizeBytes / MULTIPART_PART_BYTES));
}
