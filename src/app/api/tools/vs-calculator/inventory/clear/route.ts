import { NextResponse } from "next/server";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import {
  clearCommanderVsInventoryItem,
  resolveCommanderForVsCalculator,
} from "@/lib/vs-calculator/inventory.server";
import { loadVsCalculatorForUser } from "@/lib/vs-calculator/web-vs-calculator-read.server";

export const dynamic = "force-dynamic";

type ClearBody = {
  slug?: string;
  pinnedDate?: string | null;
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

  let body: ClearBody;
  try {
    body = (await request.json()) as ClearBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.slug?.trim()) {
    return NextResponse.json({ error: "slug is required." }, { status: 400 });
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

  await clearCommanderVsInventoryItem({
    commanderId,
    slug: body.slug.trim(),
    hqUserId: session.hqUserId,
  });

  const payload = await loadVsCalculatorForUser({
    allianceId,
    hqUserId: session.hqUserId,
    pinnedDate: body.pinnedDate,
  });

  return NextResponse.json(payload);
}
