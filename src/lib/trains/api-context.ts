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

async function resolveAshedAllianceIdForTrain(input: {
  allianceId: string;
  allianceTag: string | null;
  connection: ParsedConnection | null;
  allianceRow?: Awaited<ReturnType<typeof loadAllianceRow>>;
}): Promise<string | NextResponse> {
  const allianceRow =
    input.allianceRow ?? (await loadAllianceRow(input.allianceId));
  let ashedAllianceId = allianceRow?.ashedAllianceId?.trim() || null;

  if (!ashedAllianceId && input.connection && input.allianceTag) {
    try {
      const alliance = await resolveAllianceByTag(
        input.connection,
        input.allianceTag,
      );
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

  return ashedAllianceId || input.allianceId;
}

export async function resolveTrainRequestContext(): Promise<
  TrainRequestContext | NextResponse
> {
  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const [operatingMode, allianceRow] = await Promise.all([
    getAllianceOperatingMode(allianceId),
    loadAllianceRow(allianceId),
  ]);

  if (operatingMode === "native") {
    return {
      sessionId: session.id,
      allianceId,
      ashedAllianceId: allianceId,
      connection: null,
      operatingMode,
    };
  }

  const allianceTag =
    session.allianceTag?.trim() || allianceRow?.tag?.trim() || null;
  const storedAshedAllianceId = allianceRow?.ashedAllianceId?.trim() || null;
  const connection =
    !storedAshedAllianceId && allianceTag
      ? await getAshedConnection(session.id)
      : null;
  const ashedAllianceId = await resolveAshedAllianceIdForTrain({
    allianceId,
    allianceTag,
    connection,
    allianceRow,
  });
  if (ashedAllianceId instanceof NextResponse) return ashedAllianceId;

  return {
    sessionId: session.id,
    allianceId,
    ashedAllianceId,
    connection,
    operatingMode,
  };
}
