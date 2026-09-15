import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";
import { isVideoWorkerAllowedPath } from "@/lib/video/video-worker-mode.shared";
import { sensitiveNotesPath } from "@/lib/notes/privacy.shared";

const intlMiddleware = createMiddleware(routing);

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

  const response = intlMiddleware(request);
  if (sensitiveNotesPath(request.nextUrl.pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  // Include /api so VIDEO_WORKER_MODE can gate the Fly host surface.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
