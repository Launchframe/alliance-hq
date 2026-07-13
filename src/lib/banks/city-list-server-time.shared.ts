import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import { withTimeZoneLabel } from "@/lib/timezone/zone-label.shared";

export function formatCityListServerTime(iso: string): string {
  const date = new Date(iso);
  const formatted = new Intl.DateTimeFormat(undefined, {
    timeZone: SERVER_TIME_IANA,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
  return withTimeZoneLabel(formatted, "server", date, SERVER_TIME_IANA);
}
