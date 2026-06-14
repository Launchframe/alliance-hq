import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import {
  AllianceSelectionError,
  allianceSelectionErrorStatus,
  listAccessibleAlliances,
  resolveConnectAlliance,
} from "@/lib/alliance/connect-alliance";
import { verifyBase44Connection } from "@/lib/base44/server";
import { syncAshedAllianceRoles } from "@/lib/rbac/sync-ashed-roles";
import {
  getAshedConnection,
  getAshedConnectionMeta,
  getOrCreateSession,
  loadSession,
  updateExpiryReminderDays,
  updateSessionAlliance,
} from "@/lib/session";

const patchSchema = z
  .object({
    expiryReminderDays: z.number().int().min(1).max(90).optional(),
    allianceId: z.string().trim().min(1).optional(),
    allianceTag: z.string().trim().min(1).max(32).optional(),
  })
  .refine(
    (data) =>
      data.expiryReminderDays !== undefined ||
      data.allianceId !== undefined ||
      data.allianceTag !== undefined,
    { message: "No settings to update" },
  );

export async function GET() {
  try {
    const locale = await getLocale();
    const session = await getOrCreateSession();
    const ashed = await getAshedConnectionMeta(session.id, locale);
    const connection = await getAshedConnection(session.id);

    if (!ashed || !connection) {
      return NextResponse.json({ error: "Not connected to Ashed" }, { status: 404 });
    }

    const me = await verifyBase44Connection(connection);
    if (!me.email) {
      return NextResponse.json(
        { error: "Ashed account email is required." },
        { status: 502 },
      );
    }

    const accessibleAlliances = await listAccessibleAlliances(connection, {
      email: me.email,
      id: me.id,
    });

    return NextResponse.json({
      ashed,
      allianceTag: session.allianceTag,
      allianceId: session.allianceId,
      accessibleAlliances,
      selectedAllianceId: session.allianceId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load settings",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const locale = await getLocale();
    const body = patchSchema.parse(await request.json());
    const session = await getOrCreateSession();
    const existing = await getAshedConnectionMeta(session.id, locale);

    if (!existing) {
      return NextResponse.json({ error: "Not connected to Ashed" }, { status: 404 });
    }

    const connection = await getAshedConnection(session.id);
    if (!connection) {
      return NextResponse.json({ error: "Not connected to Ashed" }, { status: 404 });
    }

    let alliance:
      | { id: string; tag: string; name?: string }
      | undefined;

    if (body.allianceId || body.allianceTag) {
      const me = await verifyBase44Connection(connection);
      if (!me.email) {
        return NextResponse.json(
          { error: "Ashed account email is required." },
          { status: 502 },
        );
      }

      const selected = await resolveConnectAlliance(
        connection,
        { email: me.email, id: me.id },
        {
          allianceId: body.allianceId,
          allianceTag: body.allianceTag,
        },
      );

      alliance = await updateSessionAlliance(
        session.id,
        connection,
        selected.tag,
      );

      await syncAshedAllianceRoles({
        connection,
        sessionId: session.id,
        allianceTag: alliance.tag,
        currentUser: {
          id: me.id,
          email: me.email,
          full_name: me.full_name,
        },
      });
    }

    if (body.expiryReminderDays !== undefined) {
      await updateExpiryReminderDays(session.id, body.expiryReminderDays);
    }

    const ashed = await getAshedConnectionMeta(session.id, locale);
    const updatedSession = await loadSession(session.id);

    return NextResponse.json({
      ok: true,
      ashed,
      allianceTag: updatedSession?.allianceTag ?? null,
      allianceId: updatedSession?.allianceId ?? null,
      alliance,
    });
  } catch (error) {
    if (error instanceof AllianceSelectionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: allianceSelectionErrorStatus(error.code) },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid settings payload" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update settings",
      },
      { status: 500 },
    );
  }
}
