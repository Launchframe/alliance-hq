import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { loadPublicTipLink } from "@/lib/members/commander-donation.server";
import { renderStoreTipBadgePng } from "@/lib/members/store-tip-badge.server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code: string }>;
};

function absoluteOrigin(request: Request): string {
  const env = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (env) return env;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { code } = await context.params;
  const tip = await loadPublicTipLink(code);
  if (!tip) {
    return new NextResponse("Not found", { status: 404 });
  }

  const origin = absoluteOrigin(request);
  const qrPayloadUrl = `${origin}/b/${tip.code}`;
  const shortUrlDisplay = qrPayloadUrl.replace(/^https?:\/\//, "");
  const t = await getTranslations("members.profile");

  const png = await renderStoreTipBadgePng({
    headline: t("tipJarTitle"),
    commanderName: tip.displayName,
    allianceTag: tip.allianceTag,
    shortUrlDisplay,
    qrPayloadUrl,
  });

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=60",
    },
  });
}
