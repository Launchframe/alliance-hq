import { describe, expect, it } from "vitest";

import { parseAdminVideoJobsStatusFilter } from "@/lib/video/admin-video-jobs-query.shared";

describe("parseAdminVideoJobsStatusFilter", () => {
  it("defaults to failed when param is omitted", () => {
    expect(parseAdminVideoJobsStatusFilter(null)).toBe("failed");
  });

  it("returns null for all statuses", () => {
    expect(parseAdminVideoJobsStatusFilter("all")).toBeNull();
    expect(parseAdminVideoJobsStatusFilter("")).toBeNull();
  });

  it("passes through explicit status values", () => {
    expect(parseAdminVideoJobsStatusFilter("review")).toBe("review");
    expect(parseAdminVideoJobsStatusFilter("failed")).toBe("failed");
  });
});
