import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: mocks.update,
  }),
  schema: {
    conductorPoolEntries: {
      allianceId: "allianceId",
      selectedForDate: "selectedForDate",
      memberId: "memberId",
    },
  },
}));

import { movePoolSelectionForDate } from "@/lib/trains/pool";

describe("movePoolSelectionForDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("no-ops when from and to dates match", async () => {
    await movePoolSelectionForDate("ally-1", "m1", "2026-06-10", "2026-06-10");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rewrites selectedForDate for the matching pool row", async () => {
    await movePoolSelectionForDate("ally-1", "m1", "2026-06-10", "2026-06-12");

    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedForDate: "2026-06-12",
        selectedAt: expect.any(Date),
      }),
    );
    expect(mocks.updateWhere).toHaveBeenCalledOnce();
  });
});
