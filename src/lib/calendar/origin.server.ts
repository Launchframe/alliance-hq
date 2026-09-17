import "server-only";
import { resolveAppOrigin } from "@/lib/app-origin";
import { CalendarError } from "./types.shared";

export function calendarAppOrigin() {
  const url = new URL(process.env.CALENDAR_APP_ORIGIN || resolveAppOrigin());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && process.env.VERCEL !== "1";
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new CalendarError("not_configured", 503);
  return url.origin;
}
