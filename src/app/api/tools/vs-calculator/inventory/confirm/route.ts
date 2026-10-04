import { NextResponse } from "next/server";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import type { VsInventoryQuantities } from "@/lib/vs-calculator/capacity.shared";
import {
  getCommanderVsInventory,
  putCommanderVsInventory,
  resolveCommanderForVsCalculator,
} from "@/lib/vs-calculator/inventory.server";
import { loadVsCalculatorForUser } from "@/lib/vs-calculator/web-vs-calculator-read.server";

export const dynamic = "force-dynamic";

type Body = {
  quantities?: VsInventoryQuantities;
  mode?: "merge" | "replace";
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.quantities || typeof body.quantities !== "object") {
    return NextResponse.json({ error: "quantities is required." }, { status: 400 });
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

  const mode = body.mode === "replace" ? "replace" : "merge";
  let nextQuantities = body.quantities;

  if (mode === "merge") {
    const existing = await getCommanderVsInventory(commanderId);
    nextQuantities = { ...existing, ...body.quantities };
  }

  await putCommanderVsInventory({
    commanderId,
    quantities: nextQuantities,
    hqUserId: session.hqUserId,
    reason: "ocr",
  });

  const payload = await loadVsCalculatorForUser({
    allianceId,
    hqUserId: session.hqUserId,
    pinnedDate: body.pinnedDate,
    locale: body.locale ?? undefined,
  });

  return NextResponse.json(payload);
}
