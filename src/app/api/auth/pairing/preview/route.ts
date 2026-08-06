import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { isPairingPurpose } from "@/lib/credential-pairing";
import { getDb, schema } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing code." }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .select({
      purpose: schema.credentialPairingCodes.purpose,
      expiresAt: schema.credentialPairingCodes.expiresAt,
      consumedAt: schema.credentialPairingCodes.consumedAt,
      metadataJson: schema.credentialPairingCodes.metadataJson,
      sourceHqUserId: schema.credentialPairingCodes.sourceHqUserId,
    })
    .from(schema.credentialPairingCodes)
    .where(eq(schema.credentialPairingCodes.code, code))
    .limit(1);

  if (!row) {
    return NextResponse.json({ status: "invalid" });
  }

  if (row.consumedAt) {
    return NextResponse.json({ status: "linked", purpose: row.purpose });
  }

  if (row.expiresAt <= new Date()) {
    return NextResponse.json({ status: "expired", purpose: row.purpose });
  }

  let ownerDisplayName: string | null = null;
  if (row.sourceHqUserId) {
    const [owner] = await db
      .select({ displayName: schema.hqUsers.displayName, email: schema.hqUsers.email })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, row.sourceHqUserId))
      .limit(1);
    ownerDisplayName = owner?.displayName?.trim() || owner?.email || null;
  }

  return NextResponse.json({
    status: "pending",
    purpose: isPairingPurpose(row.purpose) ? row.purpose : row.purpose,
    ownerDisplayName,
    metadata: row.metadataJson ?? {},
  });
}
