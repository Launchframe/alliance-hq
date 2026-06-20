import { sanitizeBugReportConsoleText } from "@/lib/feedback/bug-report-log-sanitize";
import { NAV_GROUPS } from "@/lib/nav/routes";

export const SURVEY_FEEDBACK_SOURCES = [
  "solicited_first_upload",
  "solicited_third_upload",
  "unsolicited",
] as const;

export type SurveyFeedbackSource = (typeof SURVEY_FEEDBACK_SOURCES)[number];

export const BUG_REPORT_AREAS = [
  "alliance_management",
  "members",
  "performance_reporting",
  "donations",
  "events_operations",
  "admin_settings",
  "video_upload",
  "settings",
  "admin",
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

  const sanitized = sanitizeBugReportConsoleText(text);
  if (sanitized.length <= MAX_BUG_REPORT_CONSOLE_LOG_CHARS) {
    return sanitized;
  }

  return `${sanitized.slice(sanitized.length - MAX_BUG_REPORT_CONSOLE_LOG_CHARS)}\n…(truncated)`;
}

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

export function inferBugReportArea(pathname: string): BugReportArea {
  const path = normalizeBugReportPathname(pathname);

  for (const [prefix, area] of NATIVE_PATH_PREFIX_AREAS) {
    if (pathMatchesBugReportPrefix(path, prefix)) {
      return area;
    }
  }

  for (const [href, area] of NAV_PATH_BUG_AREA_ENTRIES) {
    if (pathMatchesBugReportPrefix(path, href)) {
      return area;
    }
  }

  return "other";
}

const NAV_GROUP_BUG_AREA: Record<string, BugReportArea> = {
  "alliance-management": "alliance_management",
  "performance-reporting": "performance_reporting",
  "events-operations": "events_operations",
  "admin-settings": "admin_settings",
};

/** Page-level overrides — more specific than nav group defaults. */
const PAGE_BUG_AREA_OVERRIDE: Record<string, BugReportArea> = {
  "/members": "members",
  "/donations": "donations",
  "/tools/video-upload": "video_upload",
  "/account": "settings",
  "/profile": "settings",
  "/settings": "settings",
};

const NATIVE_PATH_PREFIX_AREAS: ReadonlyArray<[string, BugReportArea]> = [
  ["/admin", "admin"],
  ["/account", "settings"],
  ["/profile", "settings"],
  ["/settings", "settings"],
  ["/members", "members"],
  ["/tools/video-upload", "video_upload"],
  ["/tools/video", "video_upload"],
  ["/viral-resistance", "alliance_management"],
];

const NAV_PATH_BUG_AREA_ENTRIES: ReadonlyArray<[string, BugReportArea]> =
  buildNavPathBugAreaEntries();

function buildNavPathBugAreaEntries(): Array<[string, BugReportArea]> {
  const entries: Array<[string, BugReportArea]> = [];

  for (const group of NAV_GROUPS) {
    const groupArea = NAV_GROUP_BUG_AREA[group.id] ?? "other";
    for (const page of group.pages) {
      entries.push([
        page.href,
        PAGE_BUG_AREA_OVERRIDE[page.href] ?? groupArea,
      ]);
    }
  }

  entries.push(["/settings/team", "settings"]);

  return entries.sort((a, b) => b[0].length - a[0].length);
}

function normalizeBugReportPathname(pathname: string): string {
  const withoutQuery = pathname.split("?")[0] ?? pathname;
  return withoutQuery.endsWith("/") && withoutQuery.length > 1
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

function pathMatchesBugReportPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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
