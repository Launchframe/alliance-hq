import { NextResponse } from "next/server";
import { processGeneration } from "@/lib/notes/generation.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try { return NextResponse.json(await processGeneration()); }
  catch { return NextResponse.json({ code: "failed" }, { status: 503 }); }
}
