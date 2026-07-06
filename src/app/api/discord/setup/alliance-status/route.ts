import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAllianceSetupStatusForTag } from "@/lib/alliance/alliance-setup-request.server";
import { getDiscordHqLinkByHqUserId } from "@/lib/vr/repository";

/** GET /api/discord/setup/alliance-status — poll whether tag is ready for bot install. */
export async function GET(request: Request) {
  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();
  if (!hqUserId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const hqLink = await getDiscordHqLinkByHqUserId(hqUserId);
  if (!hqLink) {
    return NextResponse.json(
      { error: "Link your Discord account first.", code: "discord_link_required" },
      { status: 422 },
    );
  }

  const url = new URL(request.url);
  const tag = url.searchParams.get("tag")?.trim();
  if (!tag) {
    return NextResponse.json({ error: "Alliance tag is required." }, { status: 400 });
  }

  const status = await getAllianceSetupStatusForTag({
    tag,
    discordUserId: hqLink.discordUserId,
  });

  return NextResponse.json({ ok: true, ...status });
}
