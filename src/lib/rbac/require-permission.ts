import { NextResponse } from "next/server";

import {
  getRbacContext,
  sessionHasPermission,
  sessionIsPlatformMaintainer,
} from "./context";

export async function requireSessionPermission(
  sessionId: string,
  permission: string | null,
): Promise<NextResponse | null> {
  const allowed = await sessionHasPermission(sessionId, permission);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function requirePlatformMaintainer(
  sessionId: string,
): Promise<NextResponse | null> {
  const ok = await sessionIsPlatformMaintainer(sessionId);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function requireAllianceAdmin(
  sessionId: string,
): Promise<NextResponse | null> {
  return requireSessionPermission(sessionId, "alliance:admin");
}

export async function requireTrainOfficer(
  sessionId: string,
): Promise<NextResponse | null> {
  return requireSessionPermission(sessionId, "trains:write");
}

export { getRbacContext };
