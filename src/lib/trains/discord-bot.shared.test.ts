import { describe, expect, it } from "vitest";

import {
  formatTrainDepartingSoonMessage,
  formatTrainReadyMessage,
  formatTrainStatusReply,
  groupTrainChannelsByAlliance,
  TRAIN_DEPARTING_SOON_ELAPSED_HOURS,
} from "@/lib/trains/discord-bot.shared";

describe("discord train message formatting", () => {
  it("formats ready message with VIP and trains link", () => {
    const text = formatTrainReadyMessage({
      conductorName: "Alice",
      vipName: "Bob",
      date: "2026-06-20",
      trainsUrl: "https://hq.example.com/pt-BR/trains",
    });
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("on the platform");
    expect(text).toContain("https://hq.example.com/pt-BR/trains");
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

  it("groups train channels by alliance for departing-soon cron", () => {
    const grouped = groupTrainChannelsByAlliance([
      { guildId: "g1", allianceId: "a1", channelId: "c1" },
      { guildId: "g2", allianceId: "a1", channelId: "c2" },
      { guildId: "g3", allianceId: "a2", channelId: "c3" },
    ]);
    expect(grouped.get("a1")).toEqual([
      { guildId: "g1", channelId: "c1" },
      { guildId: "g2", channelId: "c2" },
    ]);
    expect(grouped.get("a2")).toEqual([{ guildId: "g3", channelId: "c3" }]);
  });
});
