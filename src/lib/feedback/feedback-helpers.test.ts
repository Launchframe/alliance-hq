import { describe, expect, it } from "vitest";

import { truncateBugReportConsoleLogs, inferBugReportArea } from "@/lib/feedback/constants";
import { resolveSolicitedSource } from "@/lib/feedback/solicited-eligibility";
import {
  bugReportStorageKey,
  isAllowedBugReportScreenshotMime,
} from "@/lib/feedback/bug-report-upload";

describe("truncateBugReportConsoleLogs", () => {
  it("sanitizes secrets before persisting", () => {
    const input = 'failed token="abc123"';
    expect(truncateBugReportConsoleLogs(input)).toBe("failed token=[redacted]");
  });
});

describe("inferBugReportArea", () => {
  it("maps nav group pages and native routes", () => {
    expect(inferBugReportArea("/dashboard")).toBe("alliance_management");
    expect(inferBugReportArea("/alliances")).toBe("alliance_management");
    expect(inferBugReportArea("/members")).toBe("members");
    expect(inferBugReportArea("/donations")).toBe("donations");
    expect(inferBugReportArea("/vs-performance")).toBe("performance_reporting");
    expect(inferBugReportArea("/desert-storm")).toBe("events_operations");
    expect(inferBugReportArea("/seasonal-events")).toBe("events_operations");
    expect(inferBugReportArea("/data-management")).toBe("admin_settings");
    expect(inferBugReportArea("/tools/video-upload")).toBe("video_upload");
    expect(
      inferBugReportArea("/tools/video-upload/job-1/review"),
    ).toBe("video_upload");
    expect(inferBugReportArea("/settings")).toBe("settings");
    expect(inferBugReportArea("/settings/team")).toBe("settings");
    expect(inferBugReportArea("/admin/users")).toBe("admin");
    expect(inferBugReportArea("/viral-resistance")).toBe("alliance_management");
  });
});

describe("solicited-eligibility helpers", () => {
  it("returns first and third upload sources", () => {
    expect(resolveSolicitedSource(1)).toBe("solicited_first_upload");
    expect(resolveSolicitedSource(3)).toBe("solicited_third_upload");
    expect(resolveSolicitedSource(2)).toBeNull();
  });
});

describe("bug-report-upload", () => {
  it("accepts png screenshots", () => {
    expect(isAllowedBugReportScreenshotMime("image/png")).toBe(true);
    expect(isAllowedBugReportScreenshotMime("text/plain")).toBe(false);
  });

  it("builds storage keys", () => {
    expect(
      bugReportStorageKey({
        reportId: "r1",
        allianceId: "ally-1",
        index: 0,
      }),
    ).toBe("bug-reports/ally-1/r1/0.png");
  });
});
