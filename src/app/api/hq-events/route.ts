import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import {
  createEventOccurrence,
  EventCatalogError,
  resolveEventCatalog,
} from "@/lib/hq-events/event-catalog.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import type { EventTarget } from "@/lib/hq-events/event-types.shared";

const CATALOG_PARAMS = [
  "catalog",
  "family",
  "target",
  "seriesId",
  "from",
  "to",
  "limit",
  "cursor",
] as const;

export async function GET(request: Request) {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    const denied = await requireSessionPermission(session.id, "events:read");
    if (denied) return denied;

    const url = new URL(request.url);
    const scoreTarget = url.searchParams.get("scoreTarget");
    const allianceId = resolveSessionAllianceId(session);

    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context required." },
        { status: 400 },
      );
    }

    // Catalog mode: paginated/filterable local catalog. `scoreTarget` keeps
    // the legacy raw-list behavior used by the video review picker.
    const wantsCatalog =
      !scoreTarget &&
      CATALOG_PARAMS.some((param) => url.searchParams.has(param));
    if (wantsCatalog) {
      const catalog = await resolveEventCatalog(
        {
          allianceId,
          hqUserId: session.hqUserId ?? null,
          sessionId: session.id,
        },
        {
          family: url.searchParams.get("family") as
            | "warzone"
            | "frontline"
            | "seasonal"
            | null,
          target: url.searchParams.get("target"),
          seriesId: url.searchParams.get("seriesId"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          limit: url.searchParams.get("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
          cursor: url.searchParams.get("cursor"),
        },
      );
      return NextResponse.json(catalog);
    }

    const db = getDb();
    const conditions = [eq(schema.hqEvents.allianceId, allianceId)];
    if (scoreTarget) {
      conditions.push(eq(schema.hqEvents.scoreTarget, scoreTarget));
    }

    const events = await db
      .select()
      .from(schema.hqEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.hqEvents.createdAt));

    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list events" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    const denied = await requireSessionPermission(session.id, "hq:events:write");
    if (denied) return denied;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context required." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      scoreTarget?: string;
      name?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      seriesId?: string;
      series?: { name: string; target: EventTarget };
      ashedEventId?: string;
      boards?: { boardKey: string; name?: string; scoreType?: string }[];
    };

    // Allowlisted occurrence create/link path (event-evidence catalog).
    const isOccurrenceCreate =
      body.series != null ||
      body.seriesId != null ||
      body.boards != null ||
      body.ashedEventId != null;
    if (isOccurrenceCreate) {
      try {
        const created = await createEventOccurrence(
          {
            allianceId,
            hqUserId: session.hqUserId ?? null,
            sessionId: session.id,
          },
          {
            seriesId: body.seriesId ?? null,
            series: body.series ?? null,
            name: body.name ?? "",
            startDate: body.startDate ?? "",
            endDate: body.endDate ?? null,
            status: body.status,
            ashedEventId: body.ashedEventId ?? null,
            boards: body.boards,
          },
        );
        return NextResponse.json({ event: created });
      } catch (error) {
        if (error instanceof EventCatalogError) {
          return NextResponse.json(
            { error: error.code },
            { status: error.code === "series_not_found" ? 404 : 400 },
          );
        }
        throw error;
      }
    }

    if (!body.scoreTarget || !body.name) {
      return NextResponse.json(
        { error: "scoreTarget and name are required." },
        { status: 400 },
      );
    }

    const id = nanoid(16);
    const now = new Date();
    const db = getDb();

    await db.insert(schema.hqEvents).values({
      id,
      allianceId,
      scoreTarget: body.scoreTarget,
      name: body.name,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      status: body.status ?? "active",
      createdAt: now,
      updatedAt: now,
    });

    const [event] = await db
      .select()
      .from(schema.hqEvents)
      .where(eq(schema.hqEvents.id, id))
      .limit(1);

    await writeOfficerActionAudit({
      sessionId: session.id,
      allianceId,
      hqUserId: session.hqUserId,
      action: "hq_events.created",
      severity: "routine",
      permission: "hq:events:write",
      resourceType: "hq_event",
      resourceId: id,
      metadata: { scoreTarget: body.scoreTarget },
    });

    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create event" },
      { status: 500 },
    );
  }
}
