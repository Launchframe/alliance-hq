import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateSession, readSessionId } from "@/lib/session";
import {
  DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
  normalizeDisplayWeekStartDow,
} from "@/lib/trains/trains-display-calendar.shared";
import {
  DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
  normalizeTrainsWheelSpinSpeed,
} from "@/lib/trains/trains-wheel-speed.shared";
import {
  loadTrainsUserPreferences,
  updateTrainsUserPreferences,
} from "@/lib/trains/trains-user-preferences.server";

const patchSchema = z
  .object({
    displayWeekStartDow: z.union([z.literal(0), z.literal(1)]).optional(),
    wheelSpinSpeed: z.enum(["slow", "regular", "fast"]).optional(),
  })
  .refine(
    (body) =>
      body.displayWeekStartDow !== undefined ||
      body.wheelSpinSpeed !== undefined,
    { message: "At least one preference field is required." },
  );

export async function GET() {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({
        displayWeekStartDow: DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
        wheelSpinSpeed: DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
        canEdit: false,
      });
    }

    const session = await getOrCreateSession();
    const preferences = await loadTrainsUserPreferences(session.hqUserId);

    return NextResponse.json({
      ...preferences,
      canEdit: Boolean(session.hqUserId),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load trains preferences",
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

    const preferences = await updateTrainsUserPreferences(session.hqUserId, {
      ...(body.displayWeekStartDow !== undefined
        ? {
            displayWeekStartDow: normalizeDisplayWeekStartDow(
              body.displayWeekStartDow,
            ),
          }
        : {}),
      ...(body.wheelSpinSpeed !== undefined
        ? {
            wheelSpinSpeed: normalizeTrainsWheelSpinSpeed(body.wheelSpinSpeed),
          }
        : {}),
    });

    return NextResponse.json({
      ok: true,
      ...preferences,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid trains preferences payload." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save trains preferences",
      },
      { status: 500 },
    );
  }
}
