import { NextResponse } from "next/server";
import { runComplianceTick } from "@/lib/vs-compliance/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try {
    const result = await runComplianceTick();
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 503 : 200 });
  } catch { return NextResponse.json({ ok: false, code: "failed" }, { status: 503 }); }
}
