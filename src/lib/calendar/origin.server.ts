import "server-only";
import { resolveAppOrigin } from "@/lib/app-origin";
import { CalendarError } from "./types.shared";

export function calendarAppOrigin() {
  let url: URL;
  try { url = new URL(process.env.CALENDAR_APP_ORIGIN || resolveAppOrigin()); }
  catch { throw new CalendarError("not_configured", 503); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && process.env.VERCEL !== "1" && (process.env.NODE_ENV !== "production" || process.env.E2E_TEST === "true");
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new CalendarError("not_configured", 503);
  return url.origin;
}
