import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import {
  createPairingCode,
  isPairingPurpose,
} from "@/lib/credential-pairing";
import { PairingError, pairingErrorStatus } from "@/lib/credential-pairing/types";
import { getOrCreateSession } from "@/lib/session";

const createSchema = z.object({
  purpose: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const locale = await getLocale();
    const session = await getOrCreateSession();
    const body = createSchema.parse(await request.json());

    if (!isPairingPurpose(body.purpose)) {
      return NextResponse.json({ error: "Invalid pairing purpose." }, { status: 400 });
    }

    const result = await createPairingCode({
      purpose: body.purpose,
      sourceSessionId: session.id,
      metadata: body.metadata,
      locale,
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
      { error: error instanceof Error ? error.message : "Failed to create pairing code." },
      { status: 500 },
    );
  }
}
