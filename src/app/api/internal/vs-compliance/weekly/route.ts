import { NextResponse } from "next/server";

import { runVsComplianceWeeklyEvaluation } from "@/lib/vs-compliance/weekly-cron.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

/**
 * Monday-morning cron: evaluate alliance VS membership minimums for the
 * previously completed Mon–Sat week across every alliance with minimums
 * configured. Informational only — creates/updates officer inbox tasks;
 * never calls confirmMemberRank or any other Ashed write.
 */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runVsComplianceWeeklyEvaluation();
  return NextResponse.json({ ok: true, ...result });
}
