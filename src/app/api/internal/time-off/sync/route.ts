import { NextResponse } from "next/server";
import { runExcusedSyncTick } from "@/lib/time-off/excused-worker.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try {
    const result = await runExcusedSyncTick();
    return NextResponse.json({ ok: !("error" in result), ...result }, { status: "error" in result ? 503 : 200 });
  } catch {
    return NextResponse.json({ ok: false, code: "failed" }, { status: 503 });
  }
}
