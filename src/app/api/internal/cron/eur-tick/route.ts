import { NextResponse } from "next/server";

import { runEurTick } from "@/lib/eur/run-tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    return true;
  }
  const workerSecret = process.env.VIDEO_WORKER_SECRET;
  if (workerSecret && auth === `Bearer ${workerSecret}`) {
    return true;
  }
  return false;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runEurTick();
  return NextResponse.json({ ok: true, ...result });
}
