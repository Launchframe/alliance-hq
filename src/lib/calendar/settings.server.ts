import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CALENDAR_SOURCES } from "./types.shared";
import { calendarPrincipal, calendarSourcePermission } from "./access.server";
import { readCalendarPreferences } from "./repository.server";
import { googleCalendarConfigured } from "./google-transport.server";

export async function loadCalendarSettings(hqUserId: string, locale = "en-US") {
  return getDb().transaction(async (tx) => {
    const preferences = await readCalendarPreferences(tx, hqUserId);
    if (!preferences.version) {
      const [user] = await tx.select({ timezone: schema.hqUsers.timezone }).from(schema.hqUsers).where(eq(schema.hqUsers.id, hqUserId));
      preferences.locale = locale === "pt-BR" ? "pt-BR" : "en-US";
      preferences.timezone = user?.timezone ?? "Etc/GMT+2";
    }
    const memberships = await tx.select({ id: schema.alliances.id, tag: schema.alliances.tag, name: schema.alliances.name }).from(schema.allianceMemberships).innerJoin(schema.alliances, eq(schema.alliances.id, schema.allianceMemberships.allianceId)).where(and(eq(schema.allianceMemberships.hqUserId, hqUserId), eq(schema.allianceMemberships.status, "active")));
    const alliances: Array<(typeof memberships)[number] & { sources: Array<(typeof CALENDAR_SOURCES)[number]> }> = [];
    for (const row of memberships) {
      const principal = await calendarPrincipal(tx, hqUserId, row.id);
      if (principal && !alliances.some((item) => item.id === row.id)) alliances.push({ ...row, sources: CALENDAR_SOURCES.filter((source) => !calendarSourcePermission[source] || principal.permissions.has(calendarSourcePermission[source]!)) });
    }
    const targets = await tx.select({ id: schema.calendarTargets.id, allianceId: schema.calendarTargets.allianceId, provider: schema.calendarTargets.provider, sources: schema.calendarTargets.sources, enabled: schema.calendarTargets.enabled, version: schema.calendarTargets.version, status: schema.calendarTargets.status, cleanup: schema.calendarTargets.cleanup, creationUncertain: schema.calendarTargets.creationUncertain, lastSyncAt: schema.calendarTargets.lastSyncAt, lastFetchAt: schema.calendarTargets.lastFetchAt }).from(schema.calendarTargets).where(eq(schema.calendarTargets.hqUserId, hqUserId));
    const [account] = await tx.select({ email: schema.calendarAccounts.email, status: schema.calendarAccounts.status, version: schema.calendarAccounts.version }).from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, hqUserId));
    return { preferences, alliances, targets: targets.map((row) => ({ ...row, lastSyncAt: row.lastSyncAt?.toISOString() ?? null, lastFetchAt: row.lastFetchAt?.toISOString() ?? null })), account: account ?? null, googleAvailable: googleCalendarConfigured() };
  });
}

export type CalendarSettingsData = Awaited<ReturnType<typeof loadCalendarSettings>>;
