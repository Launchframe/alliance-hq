import { NextResponse } from "next/server";
import { runPlunderPlanTick } from "@/lib/plunder-plan/delivery.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try {
    const result = await runPlunderPlanTick();
    return NextResponse.json(result, { status: result.failed ? 503 : 200 });
  } catch { return NextResponse.json({ code: "failed" }, { status: 503 }); }
}
