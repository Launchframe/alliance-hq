import { describe, expect, it } from "vitest";

import { omitVideoJobSessionIds } from "@/lib/video/video-job-session-redact.shared";

describe("omitVideoJobSessionIds", () => {
  it("removes session cookie ids while keeping other fields", () => {
    const redacted = omitVideoJobSessionIds({
      id: "job-1",
      status: "review",
      sessionId: "cookie-value-uploader",
      processingSessionId: "cookie-value-processor",
      allianceId: "a1",
    });

    expect(redacted).toEqual({
      id: "job-1",
      status: "review",
      allianceId: "a1",
    });
    expect(redacted).not.toHaveProperty("sessionId");
    expect(redacted).not.toHaveProperty("processingSessionId");
  });

  it("works when processingSessionId is null", () => {
    const redacted = omitVideoJobSessionIds({
      id: "job-2",
      sessionId: "s1",
      processingSessionId: null,
    });
    expect(redacted).toEqual({ id: "job-2" });
  });
});
