import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepo = vi.hoisted(() => ({
  getCommanderAllianceProfession: vi.fn(),
  getEngActiveAssignment: vi.fn(),
  getEngAssignment: vi.fn(),
  upsertWlTeam: vi.fn(),
  createEngAssignment: vi.fn(),
  reactivateEngAssignment: vi.fn(),
  logWlTeamEvent: vi.fn(),
  getWlTeam: vi.fn(),
  getActiveAssignmentsForTeam: vi.fn(),
  updateAssignmentStatus: vi.fn(),
}));

vi.mock("./repository", () => mockRepo);

vi.mock("@/lib/db", () => {
  const where = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where }));
  return {
    getDb: () => ({ update: vi.fn(() => ({ set })) }),
    schema: { commanders: { id: "id" } },
  };
});

vi.mock("./notifications.server", () => ({
  notifyProfessionEvent: vi.fn(async () => undefined),
}));

import { notifyProfessionEvent } from "./notifications.server";
import { assignEngToWl, switchProfession } from "./service";

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

describe("switchProfession", () => {
  const notifiedKinds = () =>
    vi.mocked(notifyProfessionEvent).mock.calls.map(([payload]) => payload.kind);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.logWlTeamEvent.mockResolvedValue(undefined);
    mockRepo.updateAssignmentStatus.mockResolvedValue(undefined);
  });

  it("Engineer → War Leader notifies the War Leader they left and asks officers for Engineers", async () => {
    mockRepo.getEngActiveAssignment.mockResolvedValue({
      assignmentId: "assignment-1",
      wlTeamId: "wl-team-1",
      wlCommanderId: "wl-1",
    });

    await switchProfession({
      allianceId: "alliance-a",
      commanderId: "eng-1",
      fromProfession: "Engineer",
      toProfession: "War Leader",
    });

    expect(mockRepo.updateAssignmentStatus).toHaveBeenCalledWith("assignment-1", "self_removed");
    expect(mockRepo.logWlTeamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "eng_self_removed",
        wlTeamId: "wl-team-1",
        actorCommanderId: "eng-1",
        subjectCommanderId: "wl-1",
      }),
    );
    expect(notifyProfessionEvent).toHaveBeenCalledWith({
      kind: "eng_self_removed",
      allianceId: "alliance-a",
      engCommanderId: "eng-1",
      wlCommanderId: "wl-1",
    });
    expect(notifyProfessionEvent).toHaveBeenCalledWith({
      kind: "more_engs_requested",
      allianceId: "alliance-a",
      wlCommanderId: "eng-1",
    });
  });

  it("unassigned Engineer → War Leader still asks officers for Engineers", async () => {
    mockRepo.getEngActiveAssignment.mockResolvedValue(null);

    await switchProfession({
      allianceId: "alliance-a",
      commanderId: "eng-1",
      fromProfession: "Engineer",
      toProfession: "War Leader",
    });

    expect(notifiedKinds()).toEqual(["profession_switched", "more_engs_requested"]);
  });

  it("War Leader → Engineer notifies each freed Engineer and does not ask for Engineers", async () => {
    mockRepo.getWlTeam.mockResolvedValue({ id: "wl-team-1" });
    mockRepo.getActiveAssignmentsForTeam.mockResolvedValue([
      { assignmentId: "a-1", engCommanderId: "eng-1" },
      { assignmentId: "a-2", engCommanderId: "eng-2" },
    ]);

    const result = await switchProfession({
      allianceId: "alliance-a",
      commanderId: "wl-1",
      fromProfession: "War Leader",
      toProfession: "Engineer",
    });

    expect(result.freedEngs).toEqual(["eng-1", "eng-2"]);
    expect(notifiedKinds()).toEqual(["eng_dismissed", "eng_dismissed", "profession_switched"]);
  });
});
