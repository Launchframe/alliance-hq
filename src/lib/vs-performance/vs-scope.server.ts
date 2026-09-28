import "server-only";

import { createHash } from "node:crypto";

import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import type { VsActor } from "@/lib/vs-performance/weekly-view.shared";

export function vsScope(actor: VsActor, weekStart: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actor.sessionId,
        actor.hqUserId,
        actor.allianceId,
        weekStart,
      ]),
    )
    .digest("hex");
}

export function vsContextScope(actor: VsActor): string {
  return createHash('sha256').update(JSON.stringify([
    actor.sessionId, actor.hqUserId, actor.allianceId,
  ])).digest('hex');
}

export function assertVsScope(
  actor: VsActor,
  weekStart: string,
  scope: unknown,
): void {
  if (typeof scope !== "string" || scope !== vsScope(actor, weekStart)) {
    throw new VsPerformanceError("stale", 409);
  }
}
