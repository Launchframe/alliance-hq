import { NextResponse } from "next/server";

import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { getOrCreateSession } from "@/lib/session";

export type TrainRequestContext = {
  sessionId: string;
  allianceId: string;
  operatingMode: "ashed" | "native";
};

/** HQ-only train API context — no Ashed session or live API calls. */
export async function resolveTrainRequestContext(): Promise<
  TrainRequestContext | NextResponse
> {
  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const operatingMode = await getAllianceOperatingMode(allianceId);

  return {
    sessionId: session.id,
    allianceId,
    operatingMode,
  };
}
