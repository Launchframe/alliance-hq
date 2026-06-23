import { NextResponse } from "next/server";

import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";

export function memberLinkJsonResponse(result: MemberLinkApiResponse) {
  if (result.outcome === "ashed_verification_required") {
    return NextResponse.json(result, { status: 403 });
  }
  return NextResponse.json(result);
}
