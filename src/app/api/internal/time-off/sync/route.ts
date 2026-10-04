import { NextResponse } from "next/server";
import { runExcusedSyncTick } from "@/lib/time-off/excused-worker.server";
import { runTeamWorkTick } from "@/lib/support-teams/work-outbox.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try {
    const teamWork = await runTeamWorkTick().catch(() => ({ reconciled: 0, delivered: 0, failed: 1 }));
    const result = await runExcusedSyncTick();
    const ok = !("error" in result) && teamWork.failed === 0;
    return NextResponse.json({ ok, ...result, teamWork }, { status: ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, code: "failed" }, { status: 503 });
  }
}
