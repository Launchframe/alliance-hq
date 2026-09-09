import { NextResponse } from "next/server";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { base44ListMembers } from "@/lib/base44/fetch";
import {
  allianceMemberRowToAshedMember,
  listAllianceMembers,
} from "@/lib/members/roster.server";
import type { AshedMember } from "@/lib/video/member-matcher";
import type { ParsedConnection } from "@/lib/connectionString";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { getAshedConnection, requireApiSession } from "@/lib/session";

export type MembersApiContext = {
  sessionId: string;
  hqAllianceId: string;
  ashedAllianceId: string;
  connection: ParsedConnection | null;
  operatingMode: "ashed" | "native";
};

export async function loadMembersForApiContext(
  context: Pick<
    MembersApiContext,
    "operatingMode" | "hqAllianceId" | "ashedAllianceId" | "connection"
  >,
): Promise<AshedMember[]> {
  if (context.operatingMode === "native") {
    return (await listAllianceMembers(context.hqAllianceId)).map(
      allianceMemberRowToAshedMember,
    );
  }
  if (!context.connection) throw new Error("Not connected to Ashed.");
  return base44ListMembers(context.connection, context.ashedAllianceId);
}

export async function resolveMembersApiContext(): Promise<
  MembersApiContext | NextResponse
> {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const hqAllianceId = session.currentAllianceId ?? session.allianceId;
  if (!hqAllianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const operatingMode = await getAllianceOperatingMode(hqAllianceId);

  if (operatingMode === "native") {
    return {
      sessionId: session.id,
      hqAllianceId,
      ashedAllianceId: hqAllianceId,
      connection: null,
      operatingMode,
    };
  }

  if (!session.allianceTag) {
    return NextResponse.json(
      { error: "Alliance tag not set in session." },
      { status: 400 },
    );
  }

  const connection = await getAshedConnection(session.id);
  if (!connection) {
    return NextResponse.json(
      { error: "Not connected to Ashed." },
      { status: 401 },
    );
  }

  const alliance = await resolveAllianceByTag(connection, session.allianceTag);

  return {
    sessionId: session.id,
    hqAllianceId,
    ashedAllianceId: alliance.id,
    connection,
    operatingMode,
  };
}
