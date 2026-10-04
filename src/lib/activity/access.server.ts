import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { Session } from "@/lib/db/schema";
import { getRbacContext } from "@/lib/rbac/context";
import {
  requirePlatformMaintainer,
  requireSessionPermission,
} from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

import type { ActivityFeedScope } from "./feed.shared";

export type ActivityPrincipal = {
  hqUserId: string;
  sessionId: string;
  currentAllianceId: string | null;
  permissions: ReadonlySet<string>;
  isPlatformMaintainer: boolean;
  scopeFence: string;
};

export class ActivityReadError extends Error {
  constructor(
    readonly code: "unauthorized" | "forbidden" | "invalid" | "invalid_record",
    readonly status: number,
  ) {
    super(code);
    this.name = "ActivityReadError";
  }
}

export async function getActivityPrincipalForSession(
  session: Session,
): Promise<ActivityPrincipal | null> {
  if (!session.hqUserId || session.expiresAt <= new Date()) {
    return null;
  }

  const authSession = await auth();
  if (authSession?.user?.id !== session.hqUserId) {
    return null;
  }

  const context = await getRbacContext(session.id);
  if (!context || context.hqUserId !== session.hqUserId) {
    return null;
  }
  if (context.currentAllianceId !== session.currentAllianceId) {
    return null;
  }

  return {
    hqUserId: session.hqUserId,
    sessionId: session.id,
    currentAllianceId: session.currentAllianceId,
    permissions: context.permissions,
    isPlatformMaintainer:
      context.isPlatformMaintainer && context.permissions.has("hq:admin"),
    scopeFence: JSON.stringify([session.hqUserId, session.currentAllianceId]),
  };
}

export function activityAllowedScopes(
  principal: ActivityPrincipal,
): ActivityFeedScope[] {
  const scopes: ActivityFeedScope[] = ["personal"];
  if (
    principal.currentAllianceId &&
    (principal.permissions.has("hq:audit:read") ||
      principal.isPlatformMaintainer)
  ) {
    scopes.push("alliance");
  }
  if (principal.isPlatformMaintainer) {
    scopes.push("global");
  }
  return scopes;
}

export type ActivityPageGate =
  | { type: "not-found" }
  | { type: "select-alliance" }
  | { type: "feed"; allowedScopes: ActivityFeedScope[] };

function canReadAllianceActivity(principal: ActivityPrincipal): boolean {
  return (
    principal.permissions.has("hq:audit:read") ||
    principal.isPlatformMaintainer
  );
}

/** Page-level scope decision. Alliance empty-state copy is only for readers who could open that feed after selecting an alliance. */
export function resolveActivityPageGate(
  principal: ActivityPrincipal,
  scope: ActivityFeedScope,
): ActivityPageGate {
  if (
    scope === "alliance" &&
    !principal.currentAllianceId &&
    canReadAllianceActivity(principal)
  ) {
    return { type: "select-alliance" };
  }
  const allowedScopes = activityAllowedScopes(principal);
  if (!allowedScopes.includes(scope)) {
    return { type: "not-found" };
  }
  return { type: "feed", allowedScopes };
}

export async function requireActivityPrincipal(
  scope: ActivityFeedScope,
): Promise<ActivityPrincipal> {
  const session = await requireApiSession();
  if (session instanceof NextResponse) {
    throw new ActivityReadError("unauthorized", 401);
  }

  const principal = await getActivityPrincipalForSession(session);
  if (!principal) {
    throw new ActivityReadError("forbidden", 403);
  }

  const fence = (await headers()).get("x-activity-scope");
  if (fence !== null && fence !== principal.scopeFence) {
    throw new ActivityReadError("forbidden", 403);
  }

  if (scope === "global") {
    const denied = await requirePlatformMaintainer(session.id);
    if (denied) {
      throw new ActivityReadError("forbidden", 403);
    }
  } else if (scope === "alliance") {
    const denied = await requireSessionPermission(session.id, "hq:audit:read");
    if (denied) {
      throw new ActivityReadError("forbidden", 403);
    }
  }

  if (!activityAllowedScopes(principal).includes(scope)) {
    throw new ActivityReadError("forbidden", 403);
  }

  return principal;
}
