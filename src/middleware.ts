import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";
import { isVideoWorkerAllowedPath } from "@/lib/video/video-worker-mode.shared";

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

  return intlMiddleware(request);
}

export const config = {
  // Include /api so VIDEO_WORKER_MODE can gate the Fly host surface.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
