import "server-only";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, schema } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/encrypt";
import { CalendarError } from "./types.shared";
import { calendarHash, lockCalendarTarget } from "./repository.server";
import { projectCalendar } from "./projection.server";
import { serializeCalendar } from "./ics.server";
import { calendarAppOrigin } from "./origin.server";

export const calendarFeedHeaders = { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-cache, must-revalidate", "CDN-Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };

export async function calendarFeed(token: string, ifNoneMatch?: string | null) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CalendarError("not_found", 404);
  const hash = calendarHash(token);
  const [found] = await getDb().select({ id: schema.calendarTargets.id }).from(schema.calendarTargets).where(and(eq(schema.calendarTargets.feedHash, hash), eq(schema.calendarTargets.provider, "apple"), eq(schema.calendarTargets.enabled, true)));
  if (!found) throw new CalendarError("not_found", 404);
  return getDb().transaction(async (tx) => {
    await lockCalendarTarget(tx, found.id);
    const [target] = await tx.select().from(schema.calendarTargets).where(and(eq(schema.calendarTargets.id, found.id), eq(schema.calendarTargets.feedHash, hash), eq(schema.calendarTargets.enabled, true)));
    if (!target) throw new CalendarError("not_found", 404);
    const result = await projectCalendar(tx, target);
    if (!result.principal) throw new CalendarError("not_found", 404);
    const t = await getTranslations({ locale: result.preferences.locale, namespace: "calendarConnections" });
    const text = serializeCalendar(result.entries, { name: `${t("title")}${result.principal.tag ? ` — ${result.principal.tag}` : ""}`, locale: result.preferences.locale, origin: calendarAppOrigin() });
    const etag = `"${calendarHash(text)}"`;
    await tx.update(schema.calendarTargets).set({ lastFetchAt: new Date() }).where(eq(schema.calendarTargets.id, target.id));
    return { status: ifNoneMatch === etag ? 304 : 200, text, etag };
  });
}

export async function calendarFeedLink(hqUserId: string, targetId: string) {
  const [target] = await getDb().select().from(schema.calendarTargets).where(and(eq(schema.calendarTargets.id, targetId), eq(schema.calendarTargets.hqUserId, hqUserId), eq(schema.calendarTargets.provider, "apple"), eq(schema.calendarTargets.enabled, true)));
  if (!target?.feedSecret) throw new CalendarError("not_found", 404);
  const token = decryptSecret(target.feedSecret);
  if (calendarHash(token) !== target.feedHash) throw new CalendarError("not_found", 404);
  const url = new URL("/api/calendar/feed", calendarAppOrigin());
  url.searchParams.set("token", token);
  return url.href;
}
