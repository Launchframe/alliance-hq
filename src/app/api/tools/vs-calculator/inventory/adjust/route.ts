import { NextResponse } from "next/server";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import {
  adjustCommanderVsInventoryItem,
  resolveCommanderForVsCalculator,
} from "@/lib/vs-calculator/inventory.server";
import { loadVsCalculatorForUser } from "@/lib/vs-calculator/web-vs-calculator-read.server";

export const dynamic = "force-dynamic";

type AdjustBody = {
  slug?: string;
  delta?: number;
  pinnedDate?: string | null;
  locale?: string | null;
};

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  let body: AdjustBody;
  try {
    body = (await request.json()) as AdjustBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.slug?.trim() || typeof body.delta !== "number") {
    return NextResponse.json(
      { error: "slug and numeric delta are required." },
      { status: 400 },
    );
  }

  const commanderId = await resolveCommanderForVsCalculator({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!commanderId) {
    return NextResponse.json(
      { code: "member_link_required", error: "Link your commander first." },
      { status: 403 },
    );
  }

  await adjustCommanderVsInventoryItem({
    commanderId,
    slug: body.slug.trim(),
    delta: Math.trunc(body.delta),
    hqUserId: session.hqUserId,
  });

  const payload = await loadVsCalculatorForUser({
    allianceId,
    hqUserId: session.hqUserId,
    pinnedDate: body.pinnedDate,
    locale: body.locale ?? undefined,
  });

  return NextResponse.json(payload);
}
