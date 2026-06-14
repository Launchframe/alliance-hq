export const SURVEY_FEEDBACK_SOURCES = [
  "solicited_first_upload",
  "solicited_third_upload",
  "unsolicited",
] as const;

export type SurveyFeedbackSource = (typeof SURVEY_FEEDBACK_SOURCES)[number];

export const BUG_REPORT_AREAS = [
  "video_upload",
  "members",
  "settings",
  "dashboard",
  "other",
] as const;

export type BugReportArea = (typeof BUG_REPORT_AREAS)[number];

export const BUG_REPORT_SEVERITY_OPTIONS = [
  { value: 1, labelKey: "severity1" as const },
  { value: 2, labelKey: "severity2" as const },
  { value: 3, labelKey: "severity3" as const },
  { value: 4, labelKey: "severity4" as const },
] as const;

export const MAX_BUG_REPORT_SCREENSHOTS = 3;
export const MAX_BUG_REPORT_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_BUG_REPORT_CONSOLE_LOG_CHARS = 32_000;

export type CapturedScreenshot = {
  id: string;
  previewUrl: string;
  blob: Blob;
  width: number;
  height: number;
};

export function revokeCapturedScreenshotUrls(
  screenshots: CapturedScreenshot[],
): void {
  for (const shot of screenshots) {
    URL.revokeObjectURL(shot.previewUrl);
  }
}

export const FEEDBACK_SCREENSHOT_UI_ATTR = "data-feedback-screenshot-ui";

export function truncateBugReportConsoleLogs(
  text: string | undefined,
): string | undefined {
  if (!text?.trim()) {
    return undefined;
  }

  if (text.length <= MAX_BUG_REPORT_CONSOLE_LOG_CHARS) {
    return text;
  }

  return `${text.slice(text.length - MAX_BUG_REPORT_CONSOLE_LOG_CHARS)}\n…(truncated)`;
}

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

export function inferBugReportArea(pathname: string): BugReportArea {
  if (pathname.includes("/tools/video") || pathname.includes("video-upload")) {
    return "video_upload";
  }
  if (pathname.includes("/members")) {
    return "members";
  }
  if (pathname.includes("/settings")) {
    return "settings";
  }
  if (pathname.includes("/dashboard")) {
    return "dashboard";
  }
  return "other";
}

export function clientContextPayload() {
  if (typeof navigator === "undefined") {
    return { browserVersion: undefined, osVersion: undefined };
  }
  return {
    browserVersion: navigator.userAgent.slice(0, 512),
    osVersion: navigator.platform?.slice(0, 128),
  };
}
