import { NextResponse } from "next/server";
import { z } from "zod";

import { completePairing } from "@/lib/credential-pairing";
import { PairingError, pairingErrorStatus } from "@/lib/credential-pairing/types";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  code: z.string().trim().min(1),
});

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pairing failed." },
      { status: 500 },
    );
  }
}
