import { NextResponse } from "next/server";

import { runAllianceCredentialExpiryNoticePass } from "@/lib/ashed/alliance-credential-expiry.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runAllianceCredentialExpiryNoticePass();
  return NextResponse.json({ ok: true, ...result });
}
