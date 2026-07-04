import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { unlinkPasskeysForUser } from "@/lib/auth/account-linking.server";

export async function DELETE() {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await unlinkPasskeysForUser(session.user.id);

  if (!result.ok) {
    const status = result.code === "last_method" ? 409 : 404;
    return NextResponse.json({ error: result.code }, { status });
  }

  return NextResponse.json({ ok: true });
}
