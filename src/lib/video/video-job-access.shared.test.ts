import { describe, expect, it } from "vitest";

import {
  isVideoJobOwningHqUser,
  isVideoJobStatusEventForViewer,
} from "@/lib/video/video-job-access.shared";

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

describe("isVideoJobStatusEventForViewer", () => {
  it("matches the uploading browser session", () => {
    expect(
      isVideoJobStatusEventForViewer(
        { sessionId: "phone", enqueuedByHqUserId: "user-a" },
        "phone",
        "user-a",
      ),
    ).toBe(true);
  });

  it("matches the same HQ user on another device", () => {
    expect(
      isVideoJobStatusEventForViewer(
        {
          sessionId: "phone",
          enqueuedByHqUserId: "user-a",
          hqUserId: "user-a",
        },
        "laptop",
        "user-a",
      ),
    ).toBe(true);
  });

  it("rejects a different HQ user", () => {
    expect(
      isVideoJobStatusEventForViewer(
        { sessionId: "phone", enqueuedByHqUserId: "user-a" },
        "laptop",
        "user-b",
      ),
    ).toBe(false);
  });
});
