import { describe, expect, it } from "vitest";

import {
  formatTrainDepartingSoonMessage,
  formatTrainReadyMessage,
  formatTrainStatusReply,
  TRAIN_DEPARTING_SOON_ELAPSED_HOURS,
} from "@/lib/trains/discord-bot.shared";

describe("discord train message formatting", () => {
  it("formats ready message with VIP and app link", () => {
    const text = formatTrainReadyMessage({
      conductorName: "Alice",
      vipName: "Bob",
      date: "2026-06-20",
      appUrl: "https://hq.example.com",
    });
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("on the platform");
    expect(text).toContain("https://hq.example.com/trains");
  });

  it("formats status for draft conductor", () => {
    const text = formatTrainStatusReply({
      date: "2026-06-20",
      conductorMemberName: "Alice",
      vipMemberName: null,
      lockedAt: null,
    });
    expect(text).toContain("draft");
    expect(text).toContain("/train-is-ready");
  });

  it("formats departing soon reminder", () => {
    const text = formatTrainDepartingSoonMessage({
      conductorName: "Alice",
      date: "2026-06-20",
    });
    expect(text).toContain("departs soon");
  });

  it("uses 3h elapsed before departing-soon window", () => {
    expect(TRAIN_DEPARTING_SOON_ELAPSED_HOURS).toBe(3);
  });
});
