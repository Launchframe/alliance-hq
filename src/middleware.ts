import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";
import {
  decideGeoLocaleRedirect,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  VERCEL_IP_COUNTRY_HEADER,
} from "@/lib/i18n/geo-locale.shared";
import { isVideoWorkerAllowedPath } from "@/lib/video/video-worker-mode.shared";
import { sensitiveNotesPath } from "@/lib/notes/privacy.shared";

const intlMiddleware = createMiddleware(routing);

function applySensitiveNotesHeaders(response: NextResponse, pathname: string) {
  if (!sensitiveNotesPath(pathname)) return;
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
}

export default function middleware(request: NextRequest) {
  if (process.env.VIDEO_WORKER_MODE === "1") {
    if (isVideoWorkerAllowedPath(request.nextUrl.pathname)) {
      return NextResponse.next();
    }
    return new NextResponse("Not Found", { status: 404 });
  }

  // Preserve historical exclusion of API from next-intl when not in worker mode.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const geoDecision = decideGeoLocaleRedirect({
    pathname: request.nextUrl.pathname,
    localeCookie: request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    vercelCountry: request.headers.get(VERCEL_IP_COUNTRY_HEADER),
  });
  if (geoDecision.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = geoDecision.pathname;
    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE_NAME, geoDecision.locale, {
      path: "/",
      sameSite: "lax",
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    });
    applySensitiveNotesHeaders(response, url.pathname);
    return response;
  }

  const response = intlMiddleware(request);
  applySensitiveNotesHeaders(response, request.nextUrl.pathname);
  return response;
}

export const config = {
  // Include /api so VIDEO_WORKER_MODE can gate the Fly host surface.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
