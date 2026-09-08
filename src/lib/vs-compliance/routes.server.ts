import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requireApiSession } from "@/lib/session";
import { VsComplianceError } from "./types.shared";

export async function complianceApiContext() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!session.hqUserId) throw new VsComplianceError("forbidden", 403);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) throw new VsComplianceError("forbidden", 403);
  return { sessionId: session.id, allianceId };
}

export async function complianceErrorResponse(error: unknown) {
  const t = await getTranslations();
  let conflict = false;
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
    if ("code" in cause && ["40001", "40P01"].includes(String(cause.code))) conflict = true;
    cause = "cause" in cause ? cause.cause : null;
  }
  const code = error instanceof VsComplianceError ? error.code : conflict ? "changed" : "failed";
  const status = error instanceof VsComplianceError ? error.status : conflict ? 409 : 500;
  const key = code === "forbidden" ? "hotkeys.permissionRequired" : code === "changed" ? "vsCompliance.changed" : code === "handled" ? "vsCompliance.handled" : code === "reason_required" ? "vsCompliance.reasonRequired" : "statSync.actionFailed";
  return NextResponse.json({ code, error: t(key) }, { status });
}
