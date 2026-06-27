import { NextResponse } from "next/server";

import {
  MainSquadAccessError,
  setMemberMainSquad,
} from "@/lib/commanders/main-squad.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ ashedMemberId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleMainSquadUpdate(request, context, false);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleMainSquadUpdate(request, context, true);
}

async function handleMainSquadUpdate(
  request: Request,
  context: RouteContext,
  asOfficerOverride: boolean,
) {
  const session = await getOrCreateSession();
  const { ashedMemberId } = await context.params;

  let body: { mainSquad?: unknown };
  try {
    body = (await request.json()) as { mainSquad?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await setMemberMainSquad({
      sessionId: session.id,
      ashedMemberId: ashedMemberId.trim(),
      mainSquad: body.mainSquad,
      asOfficerOverride,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MainSquadAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
