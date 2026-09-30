import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { upsertAllianceAshedCredentialsFromSession } from "@/lib/ashed/alliance-credentials-manage.server";
import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import { TIME_OFF_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { requireTimeOffActor, timeOffErrorResponse } from "./route-helpers.server";
import { TimeOffError } from "./workflow.shared";
import { ExcusedSyncError } from "./excused-sync.shared";

export async function requireExcusedSyncOfficer() {
  const context = await requireTimeOffActor();
  if ("error" in context) return context;
  if (!context.actor.canManageOthers) return { error: await timeOffErrorResponse(new TimeOffError("officerOnly", 403)) };
  return context;
}

export async function refreshExcusedCredentialsFromSession(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
}) {
  const result = await upsertAllianceAshedCredentialsFromSession({
    ...input,
    allowAshedMaintainer: true,
  });
  if (!result.ok) throw new ExcusedSyncError("credentials_required");
  await writeOfficerActionAudit({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: "time_off.ashed_credentials_refresh",
    severity: "update",
    permission: TIME_OFF_WRITE_PERMISSION,
    resourceType: "alliance",
    resourceId: input.allianceId,
  });
}

export async function excusedSyncErrorResponse(error: unknown) {
  if (error instanceof TimeOffError) return timeOffErrorResponse(error);
  const t = await getTranslations("timeOff.sync");
  const code = error instanceof ExcusedSyncError ? error.code : "failed";
  return NextResponse.json({ code, error: t(code === "credentials_required" ? "credentialsRequired" : "actionFailed") }, { status: code === "failed" || code === "invalid_snapshot" ? 502 : 409 });
}
