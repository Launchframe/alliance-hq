import { NextResponse } from "next/server";

import {
  discardHqStatReport,
  keepAshedStatOnHq,
  keepHqStatOnAshed,
  listStatSyncReviewRows,
} from "@/lib/hq-ashed-stat-sync/review.server";
import type { MonotonicStatId } from "@/lib/hq-ashed-stat-sync/types";
import { getCommanderMembershipInAlliance } from "@/lib/thp/repository";
import { getRbacContext, requireSessionPermission } from "@/lib/rbac/require-permission";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function parseStat(value: unknown): MonotonicStatId | null {
  return value === "thp" || value === "kills" ? value : null;
}

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const url = new URL(request.url);
  const stat = parseStat(url.searchParams.get("stat") ?? "thp");
  if (!stat) {
    return NextResponse.json({ error: "Invalid stat" }, { status: 400 });
  }

  const rows = await listStatSyncReviewRows(allianceId, stat);
  return NextResponse.json({ stat, rows });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const rbac = await getRbacContext(session.id);
  const body = (await request.json()) as {
    action?: string;
    stat?: string;
    commanderId?: string;
    ashedMemberId?: string;
    memberName?: string;
    total?: number;
    ashedTotal?: number;
    eventId?: string | null;
  };

  const stat = parseStat(body.stat);
  if (!stat || !body.commanderId || !body.ashedMemberId) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const membership = await getCommanderMembershipInAlliance(
    body.commanderId,
    allianceId,
  );
  if (!membership || membership.ashedMemberId !== body.ashedMemberId) {
    return NextResponse.json({ error: "Invalid commander" }, { status: 403 });
  }

  const memberName = body.memberName ?? membership.memberName ?? body.ashedMemberId;

  if (body.action === "keep_hq") {
    const connection = await getAshedConnection(session.id);
    if (!connection) {
      return NextResponse.json(
        { error: "Connect Ashed to push HQ values." },
        { status: 401 },
      );
    }
    if (body.total == null) {
      return NextResponse.json({ error: "total required" }, { status: 400 });
    }
    await keepHqStatOnAshed({
      allianceId,
      stat,
      commanderId: body.commanderId,
      ashedMemberId: body.ashedMemberId,
      total: body.total,
      eventId: body.eventId ?? null,
      connection,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "keep_ashed") {
    if (body.ashedTotal == null) {
      return NextResponse.json({ error: "ashedTotal required" }, { status: 400 });
    }
    await keepAshedStatOnHq({
      allianceId,
      stat,
      commanderId: body.commanderId,
      ashedMemberId: body.ashedMemberId,
      memberName,
      ashedTotal: body.ashedTotal,
      eventId: body.eventId ?? null,
      hqUserId: rbac?.hqUserId ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "discard") {
    const connection = await getAshedConnection(session.id);
    await discardHqStatReport({
      allianceId,
      stat,
      commanderId: body.commanderId,
      ashedMemberId: body.ashedMemberId,
      memberName,
      eventId: body.eventId ?? null,
      connection,
      hqUserId: rbac?.hqUserId ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
