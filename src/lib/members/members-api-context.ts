import { NextResponse } from "next/server";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import type { ParsedConnection } from "@/lib/connectionString";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";

export type MembersApiContext = {
  sessionId: string;
  hqAllianceId: string;
  ashedAllianceId: string;
  connection: ParsedConnection;
};

export async function resolveMembersApiContext(): Promise<
  MembersApiContext | NextResponse
> {
  const session = await getOrCreateSession();
  const hqAllianceId = session.currentAllianceId ?? session.allianceId;
  if (!hqAllianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
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
  };
}
