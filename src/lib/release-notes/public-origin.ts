import { PRODUCTION_APP_ORIGIN } from "@/lib/public-site";

function isLocalDevOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Public origin for release announcements (Discord, ship console).
 * Local dev `.env.local` often sets NEXT_PUBLIC_APP_URL to localhost; production
 * release posts must still link to the hosted app.
 */
export function resolveReleaseNotesPublicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured && !isLocalDevOrigin(configured)) {
    return configured;
  }
  return PRODUCTION_APP_ORIGIN;
}

export function resolveReleaseNotesPageUrl(): string {
  return `${resolveReleaseNotesPublicOrigin()}/releases`;
}
