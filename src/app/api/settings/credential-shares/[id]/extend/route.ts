import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CredentialShareError,
  extendCredentialShare,
} from "@/lib/ashed/credential-share.server";
import { loadSession, readSessionId } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const bodySchema = z.object({
  ttlHours: z.number().min(1).max(168),
});

export async function POST(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { id } = await context.params;

  try {
    const share = await extendCredentialShare({
      shareId: id,
      sessionId,
      ttlHours: body.ttlHours,
    });
    return NextResponse.json({ share });
  } catch (error) {
    if (error instanceof CredentialShareError) {
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
