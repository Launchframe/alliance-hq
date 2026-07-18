import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
  normalizeDisplayWeekStartDow,
  type TrainsDisplayWeekStartDow,
} from "@/lib/trains/trains-display-calendar.shared";
import {
  DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
  normalizeTrainsWheelSpinSpeed,
  type TrainsWheelSpinSpeed,
} from "@/lib/trains/trains-wheel-speed.shared";

export type TrainsUserPreferences = {
  displayWeekStartDow: TrainsDisplayWeekStartDow;
  wheelSpinSpeed: TrainsWheelSpinSpeed;
  simpleModeEnabled: boolean;
};

const DEFAULT_PREFERENCES: TrainsUserPreferences = {
  displayWeekStartDow: DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
  wheelSpinSpeed: DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
  simpleModeEnabled: true,
};

function normalizeSimpleModeEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return true;
}

export async function loadTrainsUserPreferences(
  hqUserId: string | null | undefined,
): Promise<TrainsUserPreferences> {
  if (!hqUserId) {
    return DEFAULT_PREFERENCES;
  }

  const db = getDb();
  const [user] = await db
    .select({
      displayWeekStartDow: schema.hqUsers.trainsDisplayWeekStartDow,
      wheelSpinSpeed: schema.hqUsers.trainsWheelSpinSpeed,
      simpleModeEnabled: schema.hqUsers.trainsSimpleModeEnabled,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  if (!user) {
    return DEFAULT_PREFERENCES;
  }

  return {
    displayWeekStartDow: normalizeDisplayWeekStartDow(user.displayWeekStartDow),
    wheelSpinSpeed: normalizeTrainsWheelSpinSpeed(user.wheelSpinSpeed),
    simpleModeEnabled: normalizeSimpleModeEnabled(user.simpleModeEnabled),
  };
}

export async function updateTrainsUserPreferences(
  hqUserId: string,
  partial: Partial<TrainsUserPreferences>,
): Promise<TrainsUserPreferences> {
  const db = getDb();
  const patch: {
    updatedAt: Date;
    trainsDisplayWeekStartDow?: TrainsDisplayWeekStartDow;
    trainsWheelSpinSpeed?: TrainsWheelSpinSpeed;
    trainsSimpleModeEnabled?: boolean;
  } = {
    updatedAt: new Date(),
  };

  if (partial.displayWeekStartDow !== undefined) {
    patch.trainsDisplayWeekStartDow = normalizeDisplayWeekStartDow(
      partial.displayWeekStartDow,
    );
  }

  if (partial.wheelSpinSpeed !== undefined) {
    patch.trainsWheelSpinSpeed = normalizeTrainsWheelSpinSpeed(
      partial.wheelSpinSpeed,
    );
  }

  if (partial.simpleModeEnabled !== undefined) {
    patch.trainsSimpleModeEnabled = normalizeSimpleModeEnabled(
      partial.simpleModeEnabled,
    );
  }

  await db
    .update(schema.hqUsers)
    .set(patch)
    .where(eq(schema.hqUsers.id, hqUserId));

  return loadTrainsUserPreferences(hqUserId);
}
