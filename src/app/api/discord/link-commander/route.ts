import { NextResponse } from "next/server";
import { z } from "zod";

import {
  confirmDiscordMemberLinkFromWeb,
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

const bodySchema = z.discriminatedUnion("action", [
  previewBodySchema,
  confirmBodySchema,
  pickBodySchema,
]);

export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (parsed.action === "preview") {
    const result = await previewDiscordMemberLinkFromWeb({
      nonce: parsed.nonce,
      gameUid: parsed.gameUid,
    });
    return NextResponse.json(result);
  }

  if (parsed.action === "confirm") {
    const result = await confirmDiscordMemberLinkFromWeb({
      nonce: parsed.nonce,
      answer: parsed.answer,
    });
    return NextResponse.json(result);
  }

  const result = await pickDiscordMemberLinkFromWeb({
    nonce: parsed.nonce,
    memberId: parsed.memberId,
  });
  return NextResponse.json(result);
}
