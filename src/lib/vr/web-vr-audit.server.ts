import "server-only";

import { writeAuditLog } from "@/lib/bff/audit";
import type { MyVrPostResponse } from "@/lib/vr/my-vr.shared";

export type WebVrAuditPayload = {
  explicitLevel?: number | null;
  confirm?: "yes" | "no" | null;
};

export type WebVrAuditResult =
  | MyVrPostResponse
  | { code: "member_link_required" };

/** HQ audit_log trail for web self-report VR — parallel to discord_bot_audit on /vr. */
export async function auditWebVrCommand(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  ashedMemberId?: string | null;
  payload: WebVrAuditPayload;
  result: WebVrAuditResult;
}): Promise<void> {
  try {
    await writeAuditLog({
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      action: "vr.web.command",
      resourceType: "member_season_vr",
      resourceId: input.ashedMemberId ?? undefined,
      metadata: {
        command: "vr",
        channel: "web",
        payload: input.payload,
        result: input.result,
      },
    });
  } catch (error) {
    console.error("[web-vr] audit log failed", error);
  }
}
