import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { defaultDisplayPreferences, displayPreferencesSchema, type SupportDisplayPreferences } from "./display-preferences.shared";
import { SupportError } from "./types.shared";

export async function readDisplayPreferences(principalId: string) {
  const [row] = await getDb().select({ version: schema.supportTeamPreferences.version, display: schema.supportTeamPreferences.display }).from(schema.supportTeamPreferences).where(eq(schema.supportTeamPreferences.hqUserId, principalId));
  return row ? { version: row.version, display: displayPreferencesSchema.parse(row.display) } : { version: 0, display: { ...defaultDisplayPreferences } };
}
export async function saveDisplayPreferences(principalId: string, expectedVersion: number, display: SupportDisplayPreferences) {
  const validated = displayPreferencesSchema.parse(display);
  return getDb().transaction(async (db) => {
    await db.insert(schema.supportTeamPreferences).values({ hqUserId: principalId, display: defaultDisplayPreferences }).onConflictDoNothing();
    const [row] = await db.select().from(schema.supportTeamPreferences).where(eq(schema.supportTeamPreferences.hqUserId, principalId)).for("update");
    if (!row || row.version !== expectedVersion) throw new SupportError("changed");
    const result = { version: row.version + 1, display: validated };
    await db.update(schema.supportTeamPreferences).set(result).where(eq(schema.supportTeamPreferences.hqUserId, principalId));
    return result;
  });
}
