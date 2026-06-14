import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import {
  getAshedConnection,
  getAshedConnectionMeta,
  getOrCreateSession,
  updateExpiryReminderDays,
  updateSessionAlliance,
} from "@/lib/session";

const patchSchema = z
  .object({
    expiryReminderDays: z.number().int().min(1).max(90).optional(),
    allianceTag: z.string().trim().min(1).max(32).optional(),
  })
  .refine(
    (data) =>
      data.expiryReminderDays !== undefined || data.allianceTag !== undefined,
    { message: "No settings to update" },
  );

export async function GET() {
  try {
    const locale = await getLocale();
    const session = await getOrCreateSession();
    const ashed = await getAshedConnectionMeta(session.id, locale);

    if (!ashed) {
      return NextResponse.json({ error: "Not connected to Ashed" }, { status: 404 });
    }

    return NextResponse.json({
      ashed,
      allianceTag: session.allianceTag,
      allianceId: session.allianceId,
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

    let alliance:
      | { id: string; tag: string; name?: string }
      | undefined;

    if (body.allianceTag) {
      const connection = await getAshedConnection(session.id);
      if (!connection) {
        return NextResponse.json({ error: "Not connected to Ashed" }, { status: 404 });
      }
      alliance = await updateSessionAlliance(
        session.id,
        connection,
        body.allianceTag,
      );
    }

    if (body.expiryReminderDays !== undefined) {
      await updateExpiryReminderDays(session.id, body.expiryReminderDays);
    }

    const ashed = await getAshedConnectionMeta(session.id, locale);
    const updatedSession = await getOrCreateSession();

    return NextResponse.json({
      ok: true,
      ashed,
      allianceTag: updatedSession.allianceTag,
      allianceId: updatedSession.allianceId,
      alliance,
    });
  } catch (error) {
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
