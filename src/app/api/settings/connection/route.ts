import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import {
  getAshedConnectionMeta,
  getOrCreateSession,
  updateExpiryReminderDays,
} from "@/lib/session";

const patchSchema = z.object({
  expiryReminderDays: z.number().int().min(1).max(90),
});

export async function GET() {
  try {
    const locale = await getLocale();
    const session = await getOrCreateSession();
    const ashed = await getAshedConnectionMeta(session.id, locale);

    if (!ashed) {
      return NextResponse.json({ error: "Not connected to Ashed" }, { status: 404 });
    }

    return NextResponse.json({ ashed });
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

    await updateExpiryReminderDays(session.id, body.expiryReminderDays);
    const ashed = await getAshedConnectionMeta(session.id, locale);

    return NextResponse.json({ ok: true, ashed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Reminder must be between 1 and 90 days" },
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
