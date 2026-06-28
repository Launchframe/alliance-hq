import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { unlinkDiscordHqLinkForUser } from "@/lib/auth/discord-hq-link.server";

export async function POST() {
  const session = await requireAuthSession();
  const hqUserId = session?.user?.id?.trim();
  if (!hqUserId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const result = await unlinkDiscordHqLinkForUser(hqUserId);
  if (!result.ok) {
    const message =
      result.reason === "last_sign_in_method"
        ? "Add another sign-in method before unlinking Discord."
        : "Discord is not linked to this account.";
    const status = result.reason === "last_sign_in_method" ? 409 : 404;
    return NextResponse.json({ error: message, code: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
