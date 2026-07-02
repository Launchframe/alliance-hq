import { describe, expect, it } from "vitest";

import { isVideoJobOwningHqUser } from "@/lib/video/video-job-access.shared";

describe("isVideoJobOwningHqUser", () => {
  it("matches enqueuedByHqUserId", () => {
    expect(
      isVideoJobOwningHqUser("user-a", {
        enqueuedByHqUserId: "user-a",
        hqUserId: null,
      }),
    ).toBe(true);
  });

  it("matches hqUserId fallback", () => {
    expect(
      isVideoJobOwningHqUser("user-a", {
        enqueuedByHqUserId: null,
        hqUserId: "user-a",
      }),
    ).toBe(true);
  });

  it("returns false when session has no HQ user", () => {
    expect(
      isVideoJobOwningHqUser(null, {
        enqueuedByHqUserId: "user-a",
      }),
    ).toBe(false);
  });
});
