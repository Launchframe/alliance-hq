import { NextResponse } from "next/server";

import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";

export function memberLinkJsonResponse(result: MemberLinkApiResponse) {
  return NextResponse.json(result);
}
