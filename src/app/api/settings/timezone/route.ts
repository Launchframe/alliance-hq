import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import {
  getAshedConnectionMeta,
  getOrCreateSession,
  readSessionId,
} from "@/lib/session";
import { isValidAccountTimezoneId } from "@/lib/timezone/account";
import { DEFAULT_ACCOUNT_TIMEZONE_ID } from "@/lib/timezone/constants";
import {
  getAccountTimezoneIdForSession,
  updateAccountTimezone,
} from "@/lib/timezone/server";

const patchSchema = z.object({
  timezone: z.string().trim().min(1),
});

export async function GET() {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({
        timezone: DEFAULT_ACCOUNT_TIMEZONE_ID,
        canEdit: false,
      });
    }

    const session = await getOrCreateSession();
    const timezone = await getAccountTimezoneIdForSession(session.id);

    return NextResponse.json({
      timezone,
      canEdit: Boolean(session.hqUserId),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load timezone",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = patchSchema.parse(await request.json());
    const session = await getOrCreateSession();

    if (!session.hqUserId) {
      return NextResponse.json(
        { error: "Reconnect to save account preferences." },
        { status: 403 },
      );
    }

    if (!isValidAccountTimezoneId(body.timezone)) {
      return NextResponse.json(
        { error: "Invalid timezone." },
        { status: 400 },
      );
    }

    await updateAccountTimezone(session.hqUserId, body.timezone);

    const locale = await getLocale();
    const ashed = await getAshedConnectionMeta(session.id, locale);

    return NextResponse.json({
      ok: true,
      timezone: body.timezone,
      ashed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid timezone payload." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save timezone",
      },
      { status: 500 },
    );
  }
}
