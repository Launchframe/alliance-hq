import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export async function bridgeAuthUserToBrowserSession(input: {
  hqUserId: string;
  email: string;
  displayName?: string | null;
  markEmailVerified?: boolean;
}): Promise<string> {
  const session = await getOrCreateSession();
  const db = getDb();
  const now = new Date();
  const userLabel =
    input.displayName?.trim() || input.email.trim() || session.userLabel;

  if (input.markEmailVerified !== false) {
    await db
      .update(schema.hqUsers)
      .set({
        emailVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, input.hqUserId));
  }

  // #region agent log
  fetch("http://127.0.0.1:7685/ingest/a19db502-b55d-438f-8e5d-f1296113f8f3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f76120",
    },
    body: JSON.stringify({
      sessionId: "f76120",
      runId: "post-fix",
      hypothesisId: "D",
      location: "bridge-session.ts:bridgeAuthUserToBrowserSession",
      message: "bridging browser session",
      data: { hqUserIdLength: input.hqUserId.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  await db
    .update(schema.sessions)
    .set({
      hqUserId: input.hqUserId,
      userLabel: userLabel ?? null,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, session.id));

  return session.id;
}
