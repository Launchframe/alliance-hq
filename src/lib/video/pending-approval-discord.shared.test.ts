import { describe, expect, it } from "vitest";

import { formatVideoPendingApprovalDiscordMessage } from "@/lib/video/pending-approval-discord.shared";

describe("formatVideoPendingApprovalDiscordMessage", () => {
  it("includes uploader, file, leaderboard, and queue URL", () => {
    const message = formatVideoPendingApprovalDiscordMessage({
      uploader: "Alex",
      fileName: "vs.mp4",
      leaderboard: "desert-storm",
      queueUrl: "https://frontline.gay/tools/video-upload/queue",
    });
    expect(message).toContain("Alex");
    expect(message).toContain("vs.mp4");
    expect(message).toContain("desert-storm");
    expect(message).toContain("https://frontline.gay/tools/video-upload/queue");
  });

  it("uses a fallback when the uploader name is missing", () => {
    const message = formatVideoPendingApprovalDiscordMessage({
      uploader: null,
      fileName: "clip.mov",
      leaderboard: "vs-performance",
      queueUrl: "https://example.test/queue",
    });
    expect(message).toContain("Someone");
    expect(message).toContain("clip.mov");
  });
});
