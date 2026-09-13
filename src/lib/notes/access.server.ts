import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { getRbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadSession, requireApiSession } from "@/lib/session";
import type { KnowledgeActor } from "./policy.shared";
import { claimDiscordKnowledgeResources, KnowledgeAccessError } from "./resources.server";

/** Resolve the HQ Notes actor. Does not claim Discord-owned notes (read-only paths stay read-only). */
export async function getKnowledgeActorForSession(sessionId: string): Promise<(KnowledgeActor & { sessionId: string; canCreate: boolean }) | null> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) return null;
  const signedIn = await auth();
  if (signedIn?.user?.id !== session.hqUserId) return null;
  const context = await getRbacContext(sessionId);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !context?.roleName || context.hqUserId !== session.hqUserId || context.currentAllianceId !== allianceId || !context.permissions.has("notes:read") || !context.permissions.has("members:read")) return null;
  const isOfficer = ["owner", "maintainer", "officer"].includes(context.roleName);
  return {
    kind: "web", sessionId, allianceId, hqUserId: session.hqUserId, discordUserId: null,
    isOfficer, canCreate: isOfficer && context.permissions.has("notes:create"),
    readableBoardIds: [], editableBoardIds: [],
  };
}

/** Notes API/pages: Auth.js + notes permission, then one-way Discord→HQ claim for this alliance. */
export async function requireNotesApiContext(permission: "notes:read" | "notes:create" = "notes:read") {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const denied = await requireSessionPermission(session.id, permission);
  if (denied) return denied;
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor || (permission === "notes:create" && !actor.canCreate)) {
    const t = await getTranslations("notes");
    return NextResponse.json({ error: t("errors.forbidden"), code: "forbidden" }, { status: 403 });
  }
  await claimDiscordKnowledgeResources(actor);
  return { session, actor };
}

export async function notesErrorResponse(error: unknown) {
  const t = await getTranslations("notes");
  if (error instanceof KnowledgeAccessError) {
    const keys = { not_found: "notFound", changed: "errors.conflict", invalid: "errors.invalid", forbidden: "errors.forbidden", assignee_access: "tasks.assigneeAccess", intake_disabled: "intake.disabled", not_configured: "intake.unavailable", rate_limited: "intake.rateLimited", invalid_analysis: "intake.failed" } as const;
    const key = keys[error.code];
    return NextResponse.json({ error: t(key), code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: t("saveFailed"), code: "failed" }, { status: 500 });
}
