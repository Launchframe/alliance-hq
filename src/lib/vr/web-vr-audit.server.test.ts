import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(),
}));

import { writeAuditLog } from "@/lib/bff/audit";
import { auditWebVrCommand } from "@/lib/vr/web-vr-audit.server";

describe("auditWebVrCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes vr.web.command to audit_log with commander resource", async () => {
    await auditWebVrCommand({
      sessionId: "session-1",
      allianceId: "alliance-1",
      hqUserId: "hq-1",
      commanderId: "cmd-1",
      payload: { explicitInstituteLevel: null, confirm: null },
      result: { status: "set_vr", message: "Saved.", newVr: 250 },
    });

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        action: "vr.web.command",
        resourceType: "commander_season_vr",
        resourceId: "cmd-1",
        metadata: {
          command: "vr",
          channel: "web",
          payload: { explicitInstituteLevel: null, confirm: null },
          result: { status: "set_vr", message: "Saved.", newVr: 250 },
        },
      }),
    );
  });

  it("does not throw when audit_log insert fails", async () => {
    vi.mocked(writeAuditLog).mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      auditWebVrCommand({
        sessionId: "session-1",
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        payload: { explicitInstituteLevel: 16, confirm: null },
        result: { status: "validation_error", message: "Invalid level." },
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[web-vr] audit log failed",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
