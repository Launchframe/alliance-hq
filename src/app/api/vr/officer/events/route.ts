import { NextResponse } from "next/server";

import {
  formatInstituteLevelValidationError,
  validateInstituteLevelForSeason,
} from "@/lib/vr/validation";
import {
  deleteCommanderSeasonVrEvent,
  getCommanderByAshedMemberId,
  listCommanderSeasonVrEvents,
  resolveSeasonKey,
  updateCommanderSeasonVrEvent,
} from "@/lib/vr/repository";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const ashedMemberId = new URL(request.url).searchParams
    .get("ashedMemberId")
    ?.trim();
  if (!ashedMemberId) {
    return NextResponse.json(
      { error: "ashedMemberId is required." },
      { status: 400 },
    );
  }

  const seasonKey = await resolveSeasonKey(allianceId);
  const commander = await getCommanderByAshedMemberId(
    ashedMemberId,
    allianceId,
  );
  if (!commander) {
    return NextResponse.json(
      { error: "Commander not found for member." },
      { status: 404 },
    );
  }

  const events = await listCommanderSeasonVrEvents(
    commander.commanderId,
    seasonKey,
  );
  return NextResponse.json({
    seasonKey,
    commanderId: commander.commanderId,
    ashedMemberId,
    events: events.map((event) => ({
      id: event.id,
      baseVr: event.baseVr,
      instituteLevel: event.instituteLevel,
      previousBaseVr: event.previousBaseVr,
      source: event.source,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const body = (await request.json()) as {
    eventId?: string;
    instituteLevel?: number;
  };
  const eventId = body.eventId?.trim();
  if (!eventId || body.instituteLevel == null) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const seasonKey = await resolveSeasonKey(allianceId);
  const validated = validateInstituteLevelForSeason(
    seasonKey,
    body.instituteLevel,
  );
  if (!validated.ok) {
    return NextResponse.json(
      { error: formatInstituteLevelValidationError(validated) },
      { status: 400 },
    );
  }

  const result = await updateCommanderSeasonVrEvent({
    eventId,
    allianceId,
    instituteLevel: validated.instituteLevel,
    baseVr: validated.baseVr,
    hqUserId: session.hqUserId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    instituteLevel: validated.instituteLevel,
    baseVr: validated.baseVr,
  });
}

export async function DELETE(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const eventId = new URL(request.url).searchParams.get("eventId")?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required." }, { status: 400 });
  }

  const result = await deleteCommanderSeasonVrEvent({
    eventId,
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
