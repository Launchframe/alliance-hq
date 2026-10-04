import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  away: vi.fn(),
  suggestions: vi.fn(),
  active: vi.fn(),
  create: vi.fn(),
  team: vi.fn(),
  profession: vi.fn(),
  assignment: vi.fn(),
  event: vi.fn(),
}));
vi.mock("./repository", () => ({
  loadAwayProfessionCommanderIds: mocks.away,
  getWlSuggestions: mocks.suggestions,
  getEngActiveAssignment: mocks.active,
  createEngAssignment: mocks.create,
  upsertWlTeam: mocks.team,
  getCommanderAllianceProfession: mocks.profession,
  getEngAssignment: mocks.assignment,
  logWlTeamEvent: mocks.event,
}));
vi.mock("./notifications.server", () => ({ notifyProfessionEvent: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ wlMinEngsPerTeam: 2 }] }) }) }) }) };
});
vi.mock("@/lib/trains/game-time", () => ({ getServerCalendarDate: () => "2099-06-20" }));

import { assignEngToRandomWl, getSuggestionsForEng } from "./service";

describe("profession duty availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.away.mockResolvedValue(new Set());
    mocks.active.mockResolvedValue(null);
    mocks.team.mockResolvedValue("team-1");
    mocks.assignment.mockResolvedValue(null);
    mocks.profession.mockImplementation(async (_allianceId, commanderId) => ({ profession: commanderId === "eng" ? "Engineer" : "War Leader" }));
    mocks.suggestions.mockResolvedValue([{ wlCommanderId: "wl", wlName: "Lead", activeEngCount: 0 }]);
  });

  it("does not suggest work to an away Engineer or mutate their permanent pairing", async () => {
    mocks.away.mockResolvedValue(new Set(["eng"]));
    expect(await getSuggestionsForEng("alliance-1", "eng")).toEqual([]);
    expect(mocks.away).toHaveBeenCalledWith("alliance-1", "2099-06-20");
    expect(mocks.suggestions).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.team).not.toHaveBeenCalled();
  });

  it("excludes away leads without removing the existing permanent pairing", async () => {
    mocks.away.mockResolvedValue(new Set(["away-wl"]));
    mocks.active.mockResolvedValue({ wlCommanderId: "existing-wl" });
    await getSuggestionsForEng("alliance-1", "eng");
    expect(mocks.suggestions).toHaveBeenCalledWith(expect.objectContaining({ excludeWlCommanderIds: ["existing-wl", "away-wl"] }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("rechecks an automatic assignment after a lead leaves during validation", async () => {
    mocks.assignment.mockImplementation(async () => { mocks.away.mockResolvedValue(new Set(["wl"])); return null; });
    await expect(assignEngToRandomWl("alliance-1", "eng")).rejects.toThrow("No War Leaders available for assignment.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  });
});
