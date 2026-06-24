import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSet = vi.fn();
const mockWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (payload: unknown) => {
        mockSet(payload);
        return { where: mockWhere };
      },
    }),
  }),
  schema: {
    sessions: { id: "sessions.id" },
  },
}));

import {
  clearSessionAllianceContext,
  clearSessionUserBinding,
} from "@/lib/session";

describe("session alliance context clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clearSessionAllianceContext nulls alliance fields", async () => {
    await clearSessionAllianceContext("sess-1");

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        currentAllianceId: null,
        allianceId: null,
        allianceTag: null,
      }),
    );
    expect(mockWhere).toHaveBeenCalled();
  });

  it("clearSessionUserBinding nulls user binding and alliance fields", async () => {
    await clearSessionUserBinding("sess-1");

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        hqUserId: null,
        userLabel: null,
        currentAllianceId: null,
        allianceId: null,
        allianceTag: null,
      }),
    );
    expect(mockWhere).toHaveBeenCalled();
  });
});
