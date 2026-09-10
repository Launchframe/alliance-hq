/** R2/local storage keys for officer intel chat screenshots. */

export function officerIntelImageStorageKey(input: {
  allianceId: string;
  sessionId: string;
  imageId: string;
  extension?: string;
}): string {
  const allianceSegment = input.allianceId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const ext = input.extension?.replace(/^\./, "") || "png";
  return `officer-intel/${allianceSegment}/${input.sessionId}/${input.imageId}.${ext}`;
}

export const MAX_OFFICER_INTEL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_OFFICER_INTEL_IMAGES = 12;

export const OFFICER_INTEL_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export function isAllowedOfficerIntelImageMime(
  mime: string | null | undefined,
): boolean {
  if (!mime) return false;
  return OFFICER_INTEL_IMAGE_MIME_TYPES.includes(
    mime as (typeof OFFICER_INTEL_IMAGE_MIME_TYPES)[number],
  );
}

export function extensionForOfficerIntelMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}
