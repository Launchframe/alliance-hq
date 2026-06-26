import { NextResponse } from "next/server";

import { resolveAdminCommandersRequest } from "@/lib/admin/admin-commanders";
import { parseAdminCommandersQueryParams } from "@/lib/admin/admin-commanders-query.shared";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const params = parseAdminCommandersQueryParams(new URL(request.url).searchParams);
  const result = await resolveAdminCommandersRequest(params);

  if ("commander" in result) {
    if (!result.commander) {
      return NextResponse.json({ error: "Commander not found." }, { status: 404 });
    }
    return NextResponse.json({ commander: result.commander });
  }

  return NextResponse.json(result);
}
