import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  AccountMergeProofError,
  previewAccountMerge,
} from "@/lib/auth/account-merge-proof.server";
import { resolveSessionHqUserId } from "@/lib/auth/resolve-session-hq-user.server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const canonicalHqUserId = await resolveSessionHqUserId(session);
  if (!canonicalHqUserId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sourceEmail =
    typeof body === "object" &&
    body !== null &&
    "sourceEmail" in body &&
    typeof body.sourceEmail === "string"
      ? body.sourceEmail
      : "";
  const code =
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
      ? body.code
      : "";

  try {
    const preview = await previewAccountMerge({
      canonicalHqUserId,
      sourceEmailRaw: sourceEmail,
      codeRaw: code,
    });
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof AccountMergeProofError) {
      const status =
        error.code === "not_found" || error.code === "proof_expired"
          ? 410
          : error.code === "source_not_found"
            ? 404
            : error.code === "commander_conflict" ||
                error.code === "discord_conflict" ||
                error.code === "ashed_identity_conflict" ||
                error.code === "platform_maintainer" ||
                error.code === "nothing_to_merge"
              ? 409
              : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[account-merge/preview]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
