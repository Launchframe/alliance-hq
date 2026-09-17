"use client";

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { privateTelemetryUrl, sensitiveNotesPath } from "@/lib/notes/privacy.shared";

export function PrivacyTelemetry() {
  const pathname = usePathname();
  const filter = <T extends { url: string },>(event: T) => privateTelemetryUrl(event.url) || sensitiveNotesPath(window.location.pathname) ? null : event;
  if (sensitiveNotesPath(pathname)) return null;
  return <><Analytics beforeSend={filter} /><SpeedInsights beforeSend={filter} /></>;
}
