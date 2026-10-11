import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepo = vi.hoisted(() => ({
  getCommanderAllianceProfession: vi.fn(),
  getEngActiveAssignment: vi.fn(),
  commitEngAssignment: vi.fn(),
  applyProfessionSwitch: vi.fn(),
  logWlTeamEvent: vi.fn(),
  loadAwayProfessionCommanderIds: vi.fn(),
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
    mockRepo.commitEngAssignment.mockResolvedValue({
      assignmentId: "assignment-1",
      wlTeamId: "wl-team-1",
    });
    mockRepo.logWlTeamEvent.mockResolvedValue(undefined);
    mockRepo.getEngActiveAssignment.mockResolvedValue(null);
    mockRepo.loadAwayProfessionCommanderIds.mockResolvedValue(new Set());
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
    expect(mockRepo.commitEngAssignment).not.toHaveBeenCalled();
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
    expect(mockRepo.commitEngAssignment).not.toHaveBeenCalled();
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
    expect(mockRepo.commitEngAssignment).toHaveBeenCalledWith({
      allianceId: "alliance-a",
      engCommanderId: "eng-1",
      wlCommanderId: "wl-1",
      automaticDutyDate: undefined,
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

  it("commits under lock for reactivate and create paths alike", async () => {
    mockProfessions({ profession: "Engineer" }, { profession: "War Leader" });
    mockRepo.commitEngAssignment.mockResolvedValue({
      assignmentId: "assignment-old",
      wlTeamId: "wl-team-1",
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
    expect(mockRepo.commitEngAssignment).toHaveBeenCalledTimes(1);
  });
});

describe("switchProfession", () => {
  const notifiedKinds = () =>
    vi.mocked(notifyProfessionEvent).mock.calls.map(([payload]) => payload.kind);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.applyProfessionSwitch.mockResolvedValue({
      freedEngs: [],
      selfRemoved: null,
    });
  });

  it("Engineer → War Leader notifies the War Leader they left and asks officers for Engineers", async () => {
    mockRepo.applyProfessionSwitch.mockResolvedValue({
      freedEngs: [],
      selfRemoved: { wlTeamId: "wl-team-1", wlCommanderId: "wl-1" },
    });

    await switchProfession({
      allianceId: "alliance-a",
      commanderId: "eng-1",
      fromProfession: "Engineer",
      toProfession: "War Leader",
    });

    expect(mockRepo.applyProfessionSwitch).toHaveBeenCalledWith({
      allianceId: "alliance-a",
      commanderId: "eng-1",
      fromProfession: "Engineer",
      toProfession: "War Leader",
    });
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
    await switchProfession({
      allianceId: "alliance-a",
      commanderId: "eng-1",
      fromProfession: "Engineer",
      toProfession: "War Leader",
    });

    expect(notifiedKinds()).toEqual(["profession_switched", "more_engs_requested"]);
  });

  it("War Leader → Engineer notifies each freed Engineer and does not ask for Engineers", async () => {
    mockRepo.applyProfessionSwitch.mockResolvedValue({
      freedEngs: ["eng-1", "eng-2"],
      selfRemoved: null,
    });

    const result = await switchProfession({
      allianceId: "alliance-a",
      commanderId: "wl-1",
      fromProfession: "War Leader",
      toProfession: "Engineer",
    });

    expect(result.freedEngs).toEqual(["eng-1", "eng-2"]);
    expect(notifiedKinds()).toEqual([
      "eng_dismissed",
      "eng_dismissed",
      "profession_switched",
    ]);
  });
});
