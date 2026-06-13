import type { NextRequest } from "next/server";

import { bootstrapSessionResponse } from "@/lib/session";

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return bootstrapSessionResponse(safeNext, request.url);
}
