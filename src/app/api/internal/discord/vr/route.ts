import { NextResponse } from "next/server";

import {
  handleDiscordVrButtonConfirm,
  handleDiscordVrSlash,
} from "@/lib/vr/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VrRequestBody = {
  allianceId?: string;
  discordUserId?: string;
  explicitInstituteLevel?: number | null;
  confirm?: "yes" | "no";
};

function authorize(request: Request): boolean {
  const secret = process.env.DISCORD_BOT_API_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as VrRequestBody;
  const allianceId = body.allianceId?.trim();
  const discordUserId = body.discordUserId?.trim();
  if (!allianceId || !discordUserId) {
    return NextResponse.json(
      { error: "allianceId and discordUserId are required." },
      { status: 400 },
    );
  }

  const result =
    body.confirm != null
      ? await handleDiscordVrButtonConfirm({
          allianceId,
          discordUserId,
          answer: body.confirm,
          locale: "en-US",
        })
      : await handleDiscordVrSlash({
          allianceId,
          discordUserId,
          explicitInstituteLevel: body.explicitInstituteLevel,
          locale: "en-US",
        });

  return NextResponse.json(result);
}
