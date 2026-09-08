import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ away: vi.fn(), post: vi.fn(), getDb: vi.fn() }));
vi.mock("./repository", () => ({
  loadAwayProfessionCommanderIds: mocks.away,
  getProfessionChannelsForAlliance: vi.fn(async () => [{ channelId: "officer-channel" }]),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb, schema: {} }));
vi.mock("@/lib/discord/post-message.server", () => ({ postDiscordChannelMessage: mocks.post }));
vi.mock("@/lib/trains/game-time", () => ({ getServerCalendarDate: () => "2099-06-20" }));

import { notifyProfessionEvent } from "./notifications.server";

describe("profession notification absence suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.away.mockResolvedValue(new Set(["eng", "wl"]));
  });

  it("suppresses individual coverage-window nags but preserves alliance-level updates", async () => {
    await notifyProfessionEvent({ kind: "eng_assigned", allianceId: "alliance-1", engCommanderId: "eng", wlCommanderId: "wl" });
    expect(mocks.away).toHaveBeenCalledWith("alliance-1", "2099-06-20");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][1]).not.toContain("eng");
  });

  it("does not ask an away dismissed Engineer to find a new assignment", async () => {
    await notifyProfessionEvent({ kind: "eng_dismissed", allianceId: "alliance-1", engCommanderId: "eng", wlCommanderId: "wl" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
