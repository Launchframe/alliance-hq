import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import {
  loadRegularEventsSettings,
  saveRegularEventsSettings,
} from "@/lib/regular-events/settings.server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const weeklySlotSchema = z.object({
  dow: z.number().int().min(0).max(6),
  timeSt: z.string().regex(/^\d{1,2}:\d{2}$/),
});

const patchSchema = z
  .object({
    announcementsEnabled: z.boolean().optional(),
    canyonStormActive: z.boolean().optional(),
    upsertRule: z
      .object({
        eventKey: z.string().min(1),
        scheduleKind: z.enum(["weekly", "interval_after_last"]),
        weeklySlots: z.array(weeklySlotSchema).nullable().optional(),
        intervalDays: z.number().int().min(1).max(30).nullable().optional(),
        anchorTimeSt: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .nullable()
          .optional(),
        announceLeadMinutes: z.number().int().min(5).max(24 * 60).optional(),
        active: z.boolean().optional(),
      })
      .optional(),
    updateRule: z
      .object({
        ruleId: z.string().min(1),
        scheduleKind: z.enum(["weekly", "interval_after_last"]).optional(),
        weeklySlots: z.array(weeklySlotSchema).nullable().optional(),
        intervalDays: z.number().int().min(1).max(30).nullable().optional(),
        anchorTimeSt: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .nullable()
          .optional(),
        announceLeadMinutes: z.number().int().min(5).max(24 * 60).optional(),
        active: z.boolean().optional(),
      })
      .optional(),
    deleteRuleId: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      body.announcementsEnabled !== undefined ||
      body.canyonStormActive !== undefined ||
      body.upsertRule !== undefined ||
      body.updateRule !== undefined ||
      body.deleteRuleId !== undefined,
    { message: "At least one field is required." },
  );

type RouteContext = { params: Promise<{ tag: string }> };

const MANAGE_PERMISSION = "trains:write" as const;
const READ_PERMISSION = "scores:read" as const;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      READ_PERMISSION,
    );
    if (denied) return denied;

    const canManage = await sessionHasPermissionForAlliance(
      session.id,
      alliance.allianceId,
      MANAGE_PERMISSION,
    );
    const settings = await loadRegularEventsSettings(
      alliance.allianceId,
      canManage,
    );

    return NextResponse.json({
      allianceTag: alliance.tag,
      ...settings,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid regular events settings payload." },
        { status: 400 },
      );
    }

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      MANAGE_PERMISSION,
    );
    if (denied) return denied;

    const before = await loadRegularEventsSettings(alliance.allianceId, true);

    try {
      const saved = await saveRegularEventsSettings(
        alliance.allianceId,
        body.data,
        true,
      );

      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "regular_events.settings_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: {
            announcementsEnabled: before.announcementsEnabled,
            canyonStormActive: before.canyonStormActive,
            ruleCount: before.rules.length,
          },
          after: {
            announcementsEnabled: saved.announcementsEnabled,
            canyonStormActive: saved.canyonStormActive,
            ruleCount: saved.rules.length,
          },
          patch: body.data,
        },
      });

      return NextResponse.json({
        allianceTag: alliance.tag,
        ...saved,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not save settings.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
