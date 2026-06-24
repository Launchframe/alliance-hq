import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthSession } from "@/lib/auth";
import { loadSignInMethodSnapshot } from "@/lib/auth/account-linking.server";
import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import { getAuthSsoAvailability } from "@/lib/auth/sso-config.server";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await loadSignInMethodSnapshot(session.user.id);
  if (!snapshot) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const sso = getAuthSsoAvailability();

  return NextResponse.json({
    email: snapshot.email,
    hasPassword: snapshot.hasPassword,
    passkeyCount: snapshot.passkeyCount,
    linkedProviders: snapshot.linkedProviders,
    availableProviders: {
      google: sso.google,
      discord: sso.discord,
    },
  });
}

const unlinkSchema = z.object({
  provider: z.enum(["google", "discord"]),
});

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof unlinkSchema>;
  try {
    body = unlinkSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { unlinkOAuthProviderForUser } = await import(
    "@/lib/auth/account-linking.server"
  );

  const result = await unlinkOAuthProviderForUser({
    hqUserId: session.user.id,
    provider: body.provider as LinkedOAuthProvider,
  });

  if (!result.ok) {
    const status = result.code === "last_method" ? 409 : 404;
    return NextResponse.json({ error: result.code }, { status });
  }

  return NextResponse.json({ ok: true });
}
