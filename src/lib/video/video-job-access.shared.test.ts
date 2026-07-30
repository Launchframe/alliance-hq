import { describe, expect, it } from "vitest";

import {
  isVideoJobAccessibleViaSession,
  isVideoJobOwningHqUser,
  isVideoJobStatusEventForViewer,
  videoJobStatusOwnerFields,
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

describe("isVideoJobAccessibleViaSession", () => {
  it("allows legacy session-only viewers", () => {
    expect(
      isVideoJobAccessibleViaSession("s1", null, {
        sessionId: "s1",
        enqueuedByHqUserId: "user-a",
      }),
    ).toBe(true);
  });

  it("denies attributed jobs to a different HQ user on the same session", () => {
    expect(
      isVideoJobAccessibleViaSession("shared", "user-b", {
        sessionId: "shared",
        enqueuedByHqUserId: "user-a",
      }),
    ).toBe(false);
  });

  it("allows the owning HQ user on the uploading session", () => {
    expect(
      isVideoJobAccessibleViaSession("s1", "user-a", {
        sessionId: "s1",
        enqueuedByHqUserId: "user-a",
      }),
    ).toBe(true);
  });

  it("allows unattributed jobs on the session for authenticated viewers", () => {
    expect(
      isVideoJobAccessibleViaSession("s1", "user-a", {
        sessionId: "s1",
        enqueuedByHqUserId: null,
        hqUserId: null,
      }),
    ).toBe(true);
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

  it("allows the same browser session when hqUserId is null (legacy)", () => {
    expect(
      isVideoJobStatusEventForViewer(
        { sessionId: "phone", enqueuedByHqUserId: "user-a" },
        "phone",
        null,
      ),
    ).toBe(true);
  });

  it("rejects cross-device events when viewer hqUserId is null (legacy)", () => {
    expect(
      isVideoJobStatusEventForViewer(
        { sessionId: "phone", enqueuedByHqUserId: "user-a" },
        "laptop",
        null,
      ),
    ).toBe(false);
  });

  it("rejects another user's job on a reused browser session", () => {
    expect(
      isVideoJobStatusEventForViewer(
        { sessionId: "shared", enqueuedByHqUserId: "user-a" },
        "shared",
        "user-b",
      ),
    ).toBe(false);
  });

  it("rejects jobs from another alliance when currentAllianceId is set", () => {
    expect(
      isVideoJobStatusEventForViewer(
        {
          sessionId: "phone",
          enqueuedByHqUserId: "user-a",
          allianceId: "alliance-b",
        },
        "phone",
        "user-a",
        "alliance-a",
      ),
    ).toBe(false);
  });

  it("allows jobs for the current alliance", () => {
    expect(
      isVideoJobStatusEventForViewer(
        {
          sessionId: "phone",
          enqueuedByHqUserId: "user-a",
          allianceId: "alliance-a",
        },
        "phone",
        "user-a",
        "alliance-a",
      ),
    ).toBe(true);
  });

  it("includes allianceId in owner fields for SSE payloads", () => {
    expect(
      videoJobStatusOwnerFields({
        sessionId: "s1",
        hqUserId: "user-a",
        enqueuedByHqUserId: "user-a",
        allianceId: "alliance-a",
      }),
    ).toMatchObject({
      sessionId: "s1",
      allianceId: "alliance-a",
    });
  });
});
