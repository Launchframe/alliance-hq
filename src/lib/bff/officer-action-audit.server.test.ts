import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";

describe("writeTrainsOfficerAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes severity, permission, and overwrite metadata", async () => {
    mocks.writeAuditLog.mockResolvedValue(undefined);

    await writeTrainsOfficerAudit({
      sessionId: "sess-1",
      allianceId: "ally-1",
      hqUserId: "hq-1",
      action: "trains.conductor_roll",
      severity: "update",
      resourceType: "train_conductor_record",
      resourceId: "ally-1:2026-09-09",
      resourceName: "BOGGLE",
      metadata: {
        landedMemberId: "m-boggle",
        previousMemberId: "m-alice",
        overwritten: true,
        spinAgain: true,
        source: "wheel",
      },
    });

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trains.conductor_roll",
        severity: "update",
        hqUserId: "hq-1",
        metadata: expect.objectContaining({
          permission: "trains:write",
          overwritten: true,
          spinAgain: true,
          source: "wheel",
        }),
      }),
    );
  });

  it("fails open when audit insert throws", async () => {
    mocks.writeAuditLog.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      writeTrainsOfficerAudit({
        sessionId: "sess-1",
        allianceId: "ally-1",
        hqUserId: "hq-1",
        action: "trains.conductor_roll",
        severity: "routine",
        resourceType: "train_conductor_record",
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
