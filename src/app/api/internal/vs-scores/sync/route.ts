import { NextResponse } from "next/server";
import { runVsScoreSyncTick } from "@/lib/vs-scores/sync.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try { await runVsScoreSyncTick(); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ ok: false, code: "failed" }, { status: 503 }); }
}
