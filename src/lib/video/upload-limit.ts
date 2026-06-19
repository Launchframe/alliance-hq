/** Vercel serverless body limit is ~4.5 MB; keep uploads under 4 MB for headroom. */
export const MAX_VIDEO_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_VIDEO_UPLOAD_MB = 4;

/** Enforced in production only — local `next dev` has no Vercel payload cap. */
export function isVideoUploadSizeLimitEnforced(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getMaxVideoUploadBytes(): number | null {
  return isVideoUploadSizeLimitEnforced() ? MAX_VIDEO_UPLOAD_BYTES : null;
}

export function isVideoUploadOverLimit(sizeBytes: number): boolean {
  const maxBytes = getMaxVideoUploadBytes();
  return maxBytes !== null && sizeBytes > maxBytes;
}
