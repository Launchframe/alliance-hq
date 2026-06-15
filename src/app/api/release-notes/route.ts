import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/feedback/constants";
import { loadReleaseNotesFromEdgeConfig } from "@/lib/release-notes/edge-config";
import { filterReleaseNotesSince } from "@/lib/release-notes/version";
import {
  getAshedConnection,
  readSessionId,
  loadSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await getAshedConnection(session.id);
  if (!connection) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawCurrent =
    url.searchParams.get("current")?.trim() || APP_VERSION;
  const currentVersion = rawCurrent || "unknown";
  const since = url.searchParams.get("since")?.trim() || undefined;

  const notes = await loadReleaseNotesFromEdgeConfig();
  const entries = filterReleaseNotesSince(notes, since, currentVersion);

  return NextResponse.json({
    currentVersion,
    entries,
  });
}
