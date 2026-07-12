import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { handleWebKillsCommand } from "@/lib/kills/web-kills.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Mutations only — JSON total / confirm. */
export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const locale = await getLocale();
  const body = (await request.json()) as {
    total?: number | null;
    confirm?: "yes" | "no" | null;
  };

  const result = await handleWebKillsCommand({
    allianceId,
    hqUserId: session.hqUserId,
    locale,
    total: body.total,
    confirm: body.confirm,
  });

  if ("code" in result && result.code === "member_link_required") {
    return NextResponse.json(
      { code: result.code, error: "Link your commander first." },
      { status: 403 },
    );
  }

  return NextResponse.json(result);
}
