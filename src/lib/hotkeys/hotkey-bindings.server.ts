import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  emptyHotkeyBindingsPayload,
  normalizeHotkeyBindingsPayload,
} from "@/lib/hotkeys/resolve";
import type { HotkeyBindingsPayload } from "@/lib/hotkeys/types";

export async function loadHotkeyBindings(
  hqUserId: string | null | undefined,
): Promise<HotkeyBindingsPayload> {
  if (!hqUserId) {
    return emptyHotkeyBindingsPayload();
  }

  const db = getDb();
  const [user] = await db
    .select({ hotkeyBindings: schema.hqUsers.hotkeyBindings })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  return normalizeHotkeyBindingsPayload(user?.hotkeyBindings ?? null);
}

export async function saveHotkeyBindings(
  hqUserId: string,
  payload: HotkeyBindingsPayload,
): Promise<HotkeyBindingsPayload> {
  const db = getDb();
  const normalized = normalizeHotkeyBindingsPayload(payload);

  await db
    .update(schema.hqUsers)
    .set({
      hotkeyBindings: normalized,
      updatedAt: new Date(),
    })
    .where(eq(schema.hqUsers.id, hqUserId));

  return normalized;
}
