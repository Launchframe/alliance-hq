import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { getRbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadSession, requireApiSession } from "@/lib/session";
import type { KnowledgeActor } from "./policy.shared";
import { claimDiscordKnowledgeResources, KnowledgeAccessError } from "./resources.server";

export async function getKnowledgeActorForSession(sessionId: string): Promise<(KnowledgeActor & { sessionId: string }) | null> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) return null;
  const signedIn = await auth();
  if (signedIn?.user?.id !== session.hqUserId) return null;
  const context = await getRbacContext(sessionId);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !context?.roleName || context.hqUserId !== session.hqUserId || context.currentAllianceId !== allianceId || !context.permissions.has("members:read")) return null;
  const actor: KnowledgeActor & { sessionId: string } = {
    kind: "web", sessionId, allianceId, hqUserId: session.hqUserId, discordUserId: null,
    isOfficer: ["owner", "maintainer", "officer"].includes(context.roleName),
    readableBoardIds: [], editableBoardIds: [],
  };
  await claimDiscordKnowledgeResources(actor);
  return actor;
}

export async function requireNotesApiContext() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor) {
    const t = await getTranslations("notes");
    return NextResponse.json({ error: t("errors.forbidden"), code: "forbidden" }, { status: 403 });
  }
  return { session, actor };
}

export async function notesErrorResponse(error: unknown) {
  const t = await getTranslations("notes");
  if (error instanceof KnowledgeAccessError) {
    const key = error.code === "not_found" ? "notFound" : error.code === "changed" ? "errors.conflict" : "errors.forbidden";
    return NextResponse.json({ error: t(key), code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: t("saveFailed"), code: "failed" }, { status: 500 });
}
