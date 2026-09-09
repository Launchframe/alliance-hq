import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requireTimeOffActor, timeOffErrorResponse } from "./route-helpers.server";
import { TimeOffError } from "./workflow.shared";
import { ExcusedSyncError } from "./excused-sync.shared";

export async function requireExcusedSyncOfficer() {
  const context = await requireTimeOffActor();
  if ("error" in context) return context;
  if (!context.actor.canManageOthers) return { error: await timeOffErrorResponse(new TimeOffError("officerOnly", 403)) };
  return context;
}

export async function excusedSyncErrorResponse(error: unknown) {
  if (error instanceof TimeOffError) return timeOffErrorResponse(error);
  const t = await getTranslations("timeOff.sync");
  const code = error instanceof ExcusedSyncError ? error.code : "failed";
  return NextResponse.json({ code, error: t(code === "credentials_required" ? "credentialsRequired" : "actionFailed") }, { status: code === "failed" || code === "invalid_snapshot" ? 502 : 409 });
}
