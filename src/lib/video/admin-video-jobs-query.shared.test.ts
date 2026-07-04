import { describe, expect, it } from "vitest";

import {
  adminVideoJobDetailHref,
  adminVideoJobsListHref,
  buildAdminVideoJobsListSearchParams,
  parseAdminVideoJobsListFilters,
  parseAdminVideoJobsStatusFilter,
} from "@/lib/video/admin-video-jobs-query.shared";

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

describe("parseAdminVideoJobsListFilters", () => {
  it("defaults status to failed and empty optional filters", () => {
    expect(parseAdminVideoJobsListFilters(new URLSearchParams())).toEqual({
      status: "failed",
      bucket: "",
      rating: "",
      passKey: "",
    });
  });

  it("reads all filter keys from the query string", () => {
    const params = new URLSearchParams({
      status: "review",
      bucket: "q1",
      rating: "down",
      passKey: "primary",
    });
    expect(parseAdminVideoJobsListFilters(params)).toEqual({
      status: "review",
      bucket: "q1",
      rating: "down",
      passKey: "primary",
    });
  });
});

describe("buildAdminVideoJobsListSearchParams", () => {
  it("always includes status and omits empty optional filters", () => {
    const params = buildAdminVideoJobsListSearchParams({
      status: "all",
      bucket: "",
      rating: "up",
      passKey: "",
    });
    expect(params.get("status")).toBe("all");
    expect(params.get("rating")).toBe("up");
    expect(params.has("bucket")).toBe(false);
    expect(params.has("passKey")).toBe(false);
  });
});

describe("admin video jobs hrefs", () => {
  it("builds list and detail hrefs that round-trip filters", () => {
    const filters = {
      status: "complete",
      bucket: "perfect",
      rating: "up",
      passKey: "shadow",
    };
    const listHref = adminVideoJobsListHref(filters);
    expect(listHref).toBe(
      "/admin/video-jobs?status=complete&bucket=perfect&rating=up&passKey=shadow",
    );
    expect(
      parseAdminVideoJobsListFilters(new URL(listHref, "http://x").searchParams),
    ).toEqual(filters);

    const detailHref = adminVideoJobDetailHref("job-1", filters);
    expect(detailHref).toBe(
      "/admin/video-jobs/job-1?status=complete&bucket=perfect&rating=up&passKey=shadow",
    );
    expect(
      parseAdminVideoJobsListFilters(
        new URL(detailHref, "http://x").searchParams,
      ),
    ).toEqual(filters);
  });
});
