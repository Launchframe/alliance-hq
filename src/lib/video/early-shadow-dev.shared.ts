import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { VS_SHADOW_WITHHOLD_DEFAULT_MS } from "@/lib/video/early-shadow-eligibility.shared";

/** Dev/preview: always enqueue denser extraction shadow after primary extract. */
export function isVideoForceExtractionShadowEnabled(): boolean {
  if (!isDevOrPreviewEnvironment()) return false;
  const raw = process.env.VIDEO_FORCE_EXTRACTION_SHADOW?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Dev/preview: treat primary as inadequate so withhold UI can be rehearsed. */
export function isVideoDevShadowWithholdUxEnabled(): boolean {
  if (!isDevOrPreviewEnvironment()) return false;
  return process.env.VIDEO_DEV_SHADOW_UX?.trim().toLowerCase() === "withhold";
}

export function resolveShadowWithholdEscapeMs(): number {
  if (!isDevOrPreviewEnvironment()) {
    return VS_SHADOW_WITHHOLD_DEFAULT_MS;
  }
  const raw = process.env.VIDEO_DEV_SHADOW_WITHHOLD_MS?.trim();
  if (!raw) return VS_SHADOW_WITHHOLD_DEFAULT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return VS_SHADOW_WITHHOLD_DEFAULT_MS;
  }
  return Math.floor(parsed);
}
