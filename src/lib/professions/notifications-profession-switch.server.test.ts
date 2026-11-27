import { describe, expect, it, vi } from "vitest";

vi.mock("./repository", () => ({
  loadAwayProfessionCommanderIds: vi.fn(async () => new Set()),
  getProfessionChannelsForAlliance: vi.fn(async () => []),
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/lib/discord/post-message.server", () => ({ postDiscordChannelMessage: vi.fn() }));
vi.mock("@/lib/trains/game-time", () => ({ getServerCalendarDate: () => "2099-06-20" }));

import { formatProfessionSwitchMessage } from "./notifications.server";

describe("formatProfessionSwitchMessage", () => {
  const appUrl = "https://frontline.gay";

  it("names the commander and the profession change", () => {
    expect(
      formatProfessionSwitchMessage({
        commanderName: "Customer Support Dog",
        from: "War Leader",
        to: "Engineer",
        appUrl,
      }),
    ).toBe(
      "Customer Support Dog. Changed from War Leader to Engineer. Visit https://frontline.gay/professions to get started.",
    );
  });

  it("falls back to the generic update when the commander has no name", () => {
    expect(
      formatProfessionSwitchMessage({
        commanderName: null,
        from: "War Leader",
        to: "Engineer",
        appUrl,
      }),
    ).toBe(
      "Your profession has been updated: War Leader → Engineer. Visit https://frontline.gay/professions to get started.",
    );
  });
});
