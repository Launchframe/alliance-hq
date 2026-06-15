import { NextResponse } from "next/server";
import { z } from "zod";

import {
  renameLinkedDevice,
  revokeLinkedDevice,
} from "@/lib/credential-pairing/linked-devices";
import { loadSession, readSessionId } from "@/lib/session";

const patchSchema = z.object({
  deviceName: z.string().trim().min(1).max(64),
});

type Props = {
  params: Promise<{ deviceId: string }>;
};

export async function PATCH(request: Request, { params }: Props) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await loadSession(sessionId);
    if (!session?.hqUserId) {
      return NextResponse.json(
        { error: "Reconnect to manage linked devices." },
        { status: 403 },
      );
    }

    const { deviceId } = await params;
    const body = patchSchema.parse(await request.json());

    await renameLinkedDevice(session.hqUserId, deviceId, body.deviceName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid device name." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Props) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await loadSession(sessionId);
    if (!session?.hqUserId) {
      return NextResponse.json(
        { error: "Reconnect to manage linked devices." },
        { status: 403 },
      );
    }

    const { deviceId } = await params;
    const result = await revokeLinkedDevice(
      session.hqUserId,
      deviceId,
      session.id,
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Revoke failed." },
      { status: 400 },
    );
  }
}
