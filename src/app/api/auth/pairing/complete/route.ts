import { NextResponse } from "next/server";
import { z } from "zod";

import { completePairing } from "@/lib/credential-pairing";
import { PairingError, pairingErrorStatus } from "@/lib/credential-pairing/types";
import { collectDatabaseErrorText } from "@/lib/db/error-message";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  code: z.string().trim().min(1),
});

function publicPairingFailureMessage(error: unknown): string {
  const detail = collectDatabaseErrorText(error);
  if (
    detail.includes("Failed query") ||
    /insert into|update "|select /i.test(detail)
  ) {
    return "Pairing failed. Generate a new QR code and try again.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Pairing failed.";
}

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const body = bodySchema.parse(await request.json());

    const result = await completePairing(body.code, session.id, {
      clientInfo: { userAgent: request.headers.get("user-agent") },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PairingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: pairingErrorStatus(error) },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    console.error("[pairing/complete]", collectDatabaseErrorText(error));
    return NextResponse.json(
      {
        error: publicPairingFailureMessage(error),
        ...(process.env.NODE_ENV === "development"
          ? { detail: collectDatabaseErrorText(error) }
          : {}),
      },
      { status: 500 },
    );
  }
}
