import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  officer: false,
  owned: ["member-a"],
  pending: {} as Record<string, unknown>,
  saveState: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  entries: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/vr/service", () => ({ resolveAllianceForGuild: vi.fn().mockResolvedValue("alliance-a") }));
vi.mock("@/lib/vr/repository", () => ({ getDiscordUserLocale: vi.fn().mockResolvedValue("en-US") }));
vi.mock("@/lib/vr/bot-member-links.server", () => ({ listDiscordLinksForStatusQuery: () => mocks.owned.map((ashedMemberId) => ({ ashedMemberId })) }));
vi.mock("@/lib/vr/bot-officer-auth", () => ({ callerCanRunVrReport: () => mocks.officer }));
vi.mock("./discord-interaction-state.server", () => ({
  saveTimeOffInteraction: (...args: unknown[]) => { mocks.saveState(...args); return "abcdefghijklmnopqrstu"; },
  loadTimeOffInteraction: () => mocks.pending,
}));
vi.mock("./mutations.server", () => ({
  createTimeOff: (...args: unknown[]) => mocks.create(...args),
  updateTimeOff: (...args: unknown[]) => mocks.update(...args),
  cancelTimeOff: (...args: unknown[]) => mocks.cancel(...args),
  previewTimeOff: (_actor: unknown, draft: object) => ({ ...draft, memberName: "Commander A" }),
}));
vi.mock("./repository.server", () => ({
  listTimeOffRoster: () => [{ id: "member-a", name: "Commander A" }, { id: "member-b", name: "Commander B" }],
  listActiveTimeOffEntries: () => mocks.entries,
  listOwnTimeOffPage: () => ({ entries: mocks.entries, hasMore: false }),
  listTimeOffForMember: () => mocks.entries,
}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: () => mocks.entries }) }) }) }),
}));

import { handleDiscordTimeOff, openDiscordTimeOffModal } from "./discord-bot-handlers.server";
import type { DiscordInteractionPayload } from "@/lib/discord/interactions";

const payload = (name: string, options: Record<string, string> = {}): DiscordInteractionPayload => ({
  type: 2, id: "123456789012345678", guild_id: "guild-a", member: { user: { id: "discord-a" } }, locale: "en-US",
  data: { name, options: Object.entries(options).map(([name, value]) => ({ name, value, type: 3 })) },
});
const component = (action: string): DiscordInteractionPayload => ({ ...payload(""), type: 3, data: { custom_id: `timeoff:abcdefghijklmnopqrstu:${action}` } });
const entry = {
  id: "entry-a", ashedMemberId: "member-a", memberName: "Commander A", startDate: "2026-09-09", endDate: "2026-09-10",
  entryKind: "planned", source: "web", availability: "full_away", notes: "PRIVATE_REASON", version: 1, globalAbsence: true,
  cancelledAt: null, createdAt: new Date("2026-09-08T12:00:00Z"), updatedAt: new Date("2026-09-08T12:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.officer = false;
  mocks.owned = ["member-a"];
  mocks.entries = [];
  mocks.pending = {};
});

describe("Discord time-off workflow", () => {
  it("previews instead of persisting an announcement", async () => {
    const result = await handleDiscordTimeOff(payload("my-time-off", { start: "2026-09-09", end: "2026-09-10" }));
    expect(result.content).toContain("Check the commander and dates before saving.");
    expect(mocks.saveState).toHaveBeenCalledWith(expect.objectContaining({ discordUserId: "discord-a", guildId: "guild-a" }), expect.objectContaining({ kind: "draft" }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps one create intent across repeated previews without deduplicating separate announcements", async () => {
    const announcement = payload("my-time-off", { start: "2026-09-09" });
    await handleDiscordTimeOff(announcement);
    await handleDiscordTimeOff(announcement);
    const first = mocks.saveState.mock.calls[0][1];
    const repeated = mocks.saveState.mock.calls[1][1];
    expect(first.requestId).toBe(repeated.requestId);
    await handleDiscordTimeOff({ ...announcement, id: "123456789012345679" });
    expect(mocks.saveState.mock.calls[2][1].requestId).not.toBe(first.requestId);
    mocks.pending = first;
    mocks.create.mockResolvedValue(entry);
    await handleDiscordTimeOff(component("confirm"));
    await handleDiscordTimeOff({ ...component("confirm"), data: { custom_id: "timeoff:zyxwvutsrqponmlkjihgf:confirm" } });
    expect(mocks.create.mock.calls.map((call) => call[2])).toEqual([first.requestId, first.requestId]);
  });

  it("offers a picker rather than asking multi-commander members to unlink", async () => {
    mocks.owned = ["member-a", "member-b"];
    const result = await handleDiscordTimeOff(payload("my-time-off"));
    expect(result.content).toBe("Choose a commander");
    expect(result.components).toHaveLength(1);
    expect(result.content).not.toContain("unlink");
  });

  it("rejects non-officer on-behalf commands before mutation", async () => {
    const result = await handleDiscordTimeOff(payload("set-time-off", { member: "Commander B" }));
    expect(result.content).toBe("Only alliance officers can manage another member’s time off.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("never exposes private reasons in status queries", async () => {
    mocks.entries = [{ ...entry, ashedMemberId: "member-b" }];
    const result = await handleDiscordTimeOff(payload("is-ally-offline", { commander: "Commander B", date: "2026-09-09" }));
    expect(result.content).toContain("marked away");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REASON");
  });

  it("does not let members cancel an officer flag or read another member's detail", async () => {
    mocks.pending = { kind: "entry", entryId: "entry-a", version: 1 };
    mocks.entries = [{ ...entry, entryKind: "unexpected" }];
    expect((await handleDiscordTimeOff(component("cancel"))).content).toBe("You don’t have permission to change this entry.");
    expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.entries = [{ ...entry, ashedMemberId: "member-b" }];
    expect((await openDiscordTimeOffModal(component("edit"))).data).not.toHaveProperty("components");
  });

  it("refuses stale editing and returns a modal only for an authorized current entry", async () => {
    mocks.pending = { kind: "entry", entryId: "entry-a", version: 0 };
    mocks.entries = [entry];
    expect((await openDiscordTimeOffModal(component("edit"))).type).toBe(4);
    mocks.pending = { kind: "entry", entryId: "entry-a", version: 1 };
    const modal = await openDiscordTimeOffModal(component("edit"));
    expect(modal.type).toBe(9);
    expect(modal.data).toHaveProperty("components");
  });

  it("requires an explicit confirmation and carries its stored version to cancellation", async () => {
    mocks.pending = { kind: "entry", entryId: "entry-a", version: 1 };
    mocks.entries = [entry];
    const preview = await handleDiscordTimeOff(component("cancel"));
    expect(preview.content).toContain("Its history is kept.");
    expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.pending = { kind: "cancel", entryId: "entry-a", version: 1 };
    expect((await handleDiscordTimeOff(component("confirm"))).content).toBe("Time off cancelled.");
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ allianceId: "alliance-a" }), "entry-a", 1);
  });
});
