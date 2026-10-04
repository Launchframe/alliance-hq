import { NextResponse } from "next/server";
import { processKnowledgeIndex } from "@/lib/notes/knowledge-index.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
/** Leave headroom under Vercel maxDuration so a final batch can finish. */
const CRON_DEADLINE_MS = 50_000;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try {
    const started = Date.now();
    let batches = 0;
    while (Date.now() - started < CRON_DEADLINE_MS) {
      const result = await processKnowledgeIndex();
      if (!result.processed) break;
      batches += 1;
    }
    return NextResponse.json({ processed: batches > 0, batches });
  } catch { return NextResponse.json({ code: "failed" }, { status: 503 }); }
}
