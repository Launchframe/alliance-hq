import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepo = vi.hoisted(() => ({
  getCommanderAllianceProfession: vi.fn(),
  getEngActiveAssignment: vi.fn(),
  getEngAssignment: vi.fn(),
  upsertWlTeam: vi.fn(),
  createEngAssignment: vi.fn(),
  reactivateEngAssignment: vi.fn(),
  logWlTeamEvent: vi.fn(),
}));

vi.mock("./repository", () => mockRepo);

vi.mock("./notifications.server", () => ({
  notifyProfessionEvent: vi.fn(async () => undefined),
}));

import { notifyProfessionEvent } from "./notifications.server";
import { assignEngToWl } from "./service";

function mockProfessions(
  eng: { profession: string | null } | null,
  wl: { profession: string | null } | null,
) {
  mockRepo.getCommanderAllianceProfession.mockImplementation(
    async (_allianceId: string, commanderId: string) => {
      if (commanderId === "eng-1") return eng;
      if (commanderId === "wl-1") return wl;
      return null;
    },
  );
}

describe("assignEngToWl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.upsertWlTeam.mockResolvedValue("wl-team-1");
    mockRepo.getEngAssignment.mockResolvedValue(null);
    mockRepo.createEngAssignment.mockResolvedValue("assignment-1");
    mockRepo.reactivateEngAssignment.mockResolvedValue(undefined);
    mockRepo.logWlTeamEvent.mockResolvedValue(undefined);
    mockRepo.getEngActiveAssignment.mockResolvedValue(null);
  });

  it("rejects when Engineer is not in the alliance", async () => {
    mockProfessions(null, { profession: "War Leader" });
    await expect(
      assignEngToWl({
        allianceId: "alliance-a",
        engCommanderId: "eng-1",
        wlCommanderId: "wl-1",
      }),
    ).rejects.toThrow("Commander is not a member of this alliance.");
    expect(mockRepo.createEngAssignment).not.toHaveBeenCalled();
  });

  it("rejects when War Leader is not in the alliance", async () => {
    mockProfessions({ profession: "Engineer" }, null);
    await expect(
      assignEngToWl({
        allianceId: "alliance-a",
        engCommanderId: "eng-1",
        wlCommanderId: "wl-1",
      }),
    ).rejects.toThrow("Commander is not a member of this alliance.");
  });

  it("rejects when Engineer has the wrong profession", async () => {
    mockProfessions({ profession: "War Leader" }, { profession: "War Leader" });
    await expect(
      assignEngToWl({
        allianceId: "alliance-a",
        engCommanderId: "eng-1",
        wlCommanderId: "wl-1",
      }),
    ).rejects.toThrow("Commander must be a Engineer.");
  });

  it("enforces a single active assignment per Engineer", async () => {
    mockProfessions({ profession: "Engineer" }, { profession: "War Leader" });
    mockRepo.getEngActiveAssignment.mockResolvedValue({
      assignmentId: "existing",
      wlTeamId: "team-other",
      wlCommanderId: "wl-other",
    });
    await expect(
      assignEngToWl({
        allianceId: "alliance-a",
        engCommanderId: "eng-1",
        wlCommanderId: "wl-1",
      }),
    ).rejects.toThrow(
      "Engineer is already assigned to another War Leader's team.",
    );
    expect(mockRepo.createEngAssignment).not.toHaveBeenCalled();
  });

  it("creates an assignment when professions and availability are valid", async () => {
    mockProfessions({ profession: "Engineer" }, { profession: "War Leader" });
    const result = await assignEngToWl({
      allianceId: "alliance-a",
      engCommanderId: "eng-1",
      wlCommanderId: "wl-1",
    });
    expect(result).toEqual({
      assignmentId: "assignment-1",
      wlTeamId: "wl-team-1",
    });
    expect(mockRepo.createEngAssignment).toHaveBeenCalledWith({
      wlTeamId: "wl-team-1",
      allianceId: "alliance-a",
      engCommanderId: "eng-1",
    });
    expect(notifyProfessionEvent).toHaveBeenCalled();
  });

  it("skips notifications when suppressNotifications is set", async () => {
    vi.mocked(notifyProfessionEvent).mockClear();
    mockProfessions({ profession: "Engineer" }, { profession: "War Leader" });
    await assignEngToWl({
      allianceId: "alliance-a",
      engCommanderId: "eng-1",
      wlCommanderId: "wl-1",
      suppressNotifications: true,
    });
    expect(notifyProfessionEvent).not.toHaveBeenCalled();
  });

  it("reactivates a dismissed/self_removed row instead of inserting a duplicate", async () => {
    mockProfessions({ profession: "Engineer" }, { profession: "War Leader" });
    mockRepo.getEngAssignment.mockResolvedValue({
      id: "assignment-old",
      status: "self_removed",
      wlTeamId: "wl-team-1",
      engCommanderId: "eng-1",
    });
    const result = await assignEngToWl({
      allianceId: "alliance-a",
      engCommanderId: "eng-1",
      wlCommanderId: "wl-1",
    });
    expect(result).toEqual({
      assignmentId: "assignment-old",
      wlTeamId: "wl-team-1",
    });
    expect(mockRepo.reactivateEngAssignment).toHaveBeenCalledWith(
      "assignment-old", undefined,
    );
    expect(mockRepo.createEngAssignment).not.toHaveBeenCalled();
  });
});
