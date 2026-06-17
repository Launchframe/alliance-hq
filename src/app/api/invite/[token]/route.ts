import { NextResponse } from "next/server";

import { loadHqInvitePreview } from "@/lib/native-alliance/invites";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const preview = await loadHqInvitePreview(decodeURIComponent(token));

  if (!preview) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  return NextResponse.json({ invite: preview });
}
