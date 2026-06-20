import type { NextRequest } from "next/server";

import { bootstrapSessionResponse } from "@/lib/session";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = sanitizeInternalRedirectPath(next) ?? "/";
  return bootstrapSessionResponse(safeNext, request.url);
}
