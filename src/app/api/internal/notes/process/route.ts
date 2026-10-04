import { NextResponse } from "next/server";
import { processHistoryStep } from "@/lib/notes/import-worker.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try { return NextResponse.json(await processHistoryStep()); }
  catch { return NextResponse.json({ code: "failed" }, { status: 503 }); }
}
