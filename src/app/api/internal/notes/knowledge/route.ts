import { NextResponse } from "next/server";
import { processKnowledgeIndex } from "@/lib/notes/knowledge-index.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403 });
  try { return NextResponse.json(await processKnowledgeIndex()); }
  catch { return NextResponse.json({ code: "failed" }, { status: 503 }); }
}
