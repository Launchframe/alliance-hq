import { NextResponse } from "next/server";

import { upsertAllianceAshedCredentialsFromSession } from "@/lib/ashed/alliance-credentials-manage.server";
import { requireAllianceSettingsSession } from "@/lib/settings/alliance-settings-access.server";
import { loadSession, readSessionId } from "@/lib/session";

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { locale?: string };
  const access = await requireAllianceSettingsSession(
    session,
    body.locale ?? "en-US",
  );
  if ("pickAlliance" in access || !access.allianceId) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  const result = await upsertAllianceAshedCredentialsFromSession({
    sessionId,
    allianceId: access.allianceId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
