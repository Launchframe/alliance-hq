import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthSession } from "@/lib/auth";
import {
  confirmDiscordMemberLinkFromWeb,
  confirmDiscordMemberLinkHomeFromWeb,
  pickDiscordMemberLinkFromWeb,
  previewDiscordMemberLinkFromWeb,
} from "@/lib/vr/discord-member-link-web.server";

export const dynamic = "force-dynamic";

const previewBodySchema = z.object({
  action: z.literal("preview"),
  nonce: z.string().trim().min(1),
  gameUid: z.string().trim().min(1).max(20),
});

const confirmBodySchema = z.object({
  action: z.literal("confirm"),
  nonce: z.string().trim().min(1),
  answer: z.enum(["yes", "no"]),
});

const pickBodySchema = z.object({
  action: z.literal("pick"),
  nonce: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

const confirmHomeBodySchema = z.object({
  action: z.literal("confirm_home"),
  nonce: z.string().trim().min(1),
  choice: z.enum(["alliance", "lookup"]),
});

const bodySchema = z.discriminatedUnion("action", [
  previewBodySchema,
  confirmBodySchema,
  confirmHomeBodySchema,
  pickBodySchema,
]);

export async function POST(request: Request) {
  const authSession = await requireAuthSession();
  const hqUserId = authSession?.user?.id?.trim() ?? null;
  if (!hqUserId) {
    return NextResponse.json(
      { outcome: "error", message: "Sign in to continue linking your commander." },
      { status: 401 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (parsed.action === "preview") {
    const result = await previewDiscordMemberLinkFromWeb(
      {
        nonce: parsed.nonce,
        gameUid: parsed.gameUid,
      },
      hqUserId,
    );
    return NextResponse.json(result);
  }

  if (parsed.action === "confirm") {
    const result = await confirmDiscordMemberLinkFromWeb(
      {
        nonce: parsed.nonce,
        answer: parsed.answer,
      },
      hqUserId,
    );
    return NextResponse.json(result);
  }

  if (parsed.action === "confirm_home") {
    const result = await confirmDiscordMemberLinkHomeFromWeb(
      {
        nonce: parsed.nonce,
        choice: parsed.choice,
      },
      hqUserId,
    );
    return NextResponse.json(result);
  }

  const result = await pickDiscordMemberLinkFromWeb(
    {
      nonce: parsed.nonce,
      memberId: parsed.memberId,
    },
    hqUserId,
  );
  return NextResponse.json(result);
}
