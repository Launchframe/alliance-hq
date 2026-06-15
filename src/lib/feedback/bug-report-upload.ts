export const ALLOWED_BUG_REPORT_SCREENSHOT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export function isAllowedBugReportScreenshotMime(mimetype?: string | null) {
  if (!mimetype) {
    return false;
  }

  return ALLOWED_BUG_REPORT_SCREENSHOT_MIME_TYPES.includes(
    mimetype as (typeof ALLOWED_BUG_REPORT_SCREENSHOT_MIME_TYPES)[number],
  );
}

export function bugReportStorageKey({
  reportId,
  allianceId,
  index,
}: {
  reportId: string;
  allianceId?: string | null;
  index: number;
}) {
  const segment = allianceId?.replace(/[^a-zA-Z0-9._-]+/g, "-") || "platform";
  return `bug-reports/${segment}/${reportId}/${index}.png`;
}
