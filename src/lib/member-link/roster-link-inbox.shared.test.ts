import { describe, expect, it } from "vitest";

import {
  ROSTER_LINK_INBOX_KIND,
  resolveRosterLinkInboxHref,
  rosterLinkRequestHref,
} from "@/lib/member-link/roster-link-inbox.shared";

describe("rosterLinkRequestHref", () => {
  it("points at the review page with the request id", () => {
    expect(rosterLinkRequestHref("req-1")).toBe(
      "/members/roster-link-requests?request=req-1",
    );
  });

  it("encodes the request id", () => {
    expect(rosterLinkRequestHref("a b")).toBe(
      "/members/roster-link-requests?request=a%20b",
    );
  });
});

describe("resolveRosterLinkInboxHref", () => {
  it("rewrites legacy /inbox hrefs when resourceId is present", () => {
    expect(
      resolveRosterLinkInboxHref({
        kind: ROSTER_LINK_INBOX_KIND,
        resourceId: "req-1",
        href: "/inbox",
      }),
    ).toBe("/members/roster-link-requests?request=req-1");
  });

  it("falls back to the list page when resourceId is missing", () => {
    expect(
      resolveRosterLinkInboxHref({
        kind: ROSTER_LINK_INBOX_KIND,
        resourceId: null,
        href: "/inbox",
      }),
    ).toBe("/members/roster-link-requests");
  });

  it("leaves non-roster items unchanged", () => {
    expect(
      resolveRosterLinkInboxHref({
        kind: "video_jobs_pending",
        resourceId: null,
        href: "/tools/video-upload/queue",
      }),
    ).toBe("/tools/video-upload/queue");
  });
});
