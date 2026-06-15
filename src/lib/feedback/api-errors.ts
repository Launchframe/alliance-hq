import { NextResponse } from "next/server";

export function feedbackErrorResponse(
  clientMessage: string,
  status = 500,
): NextResponse {
  return NextResponse.json({ error: clientMessage }, { status });
}
