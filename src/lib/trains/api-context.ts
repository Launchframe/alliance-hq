import { NextResponse } from "next/server";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import type { ParsedConnection } from "@/lib/connectionString";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";

export type TrainRequestContext = {
  sessionId: string;
  allianceId: string;
  ashedAllianceId: string;
  connection: ParsedConnection | null;
  operatingMode: "ashed" | "native";
};

export async function resolveTrainRequestContext(): Promise<
  TrainRequestContext | NextResponse
> {
  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const operatingMode = await getAllianceOperatingMode(allianceId);

  if (operatingMode === "native") {
    if (!session.allianceTag) {
      return NextResponse.json(
        { error: "Alliance tag not set in session." },
        { status: 400 },
      );
    }

    return {
      sessionId: session.id,
      allianceId,
      ashedAllianceId: allianceId,
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

  const allianceRow = await loadAllianceRow(allianceId);
  let ashedAllianceId = allianceRow?.ashedAllianceId?.trim() || null;

  if (!ashedAllianceId) {
    try {
      const alliance = await resolveAllianceByTag(connection, session.allianceTag);
      ashedAllianceId = alliance.id;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not resolve alliance.";
      const status = message.includes("(429)") ? 503 : 502;
      return NextResponse.json(
        {
          error:
            status === 503
              ? "Ashed is rate-limiting requests. Wait a moment and try again."
              : message,
        },
        { status },
      );
    }
  }

  return {
    sessionId: session.id,
    allianceId,
    ashedAllianceId,
    connection,
    operatingMode,
  };
}
