import { NextResponse } from "next/server";

import { sendOpsAlert } from "@/lib/ops/alert.server";
import { withApiErrorHandler } from "@/lib/ops/api-error";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

/** Maintainer-only smoke test for Discord/email alerting. */
async function postHandler() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const result = await sendOpsAlert({
    severity: "info",
    source: "admin/test",
    title: "Test ops alert",
    body: "This is a test alert from the Alliance HQ admin observability panel.",
    fingerprint: `test:${Date.now()}`,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const POST = withApiErrorHandler(postHandler);
