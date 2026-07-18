import { NextResponse } from "next/server";

import {
  CommanderDonationError,
  listStoreSpend,
  softDeleteDonationReceipt,
  type StoreSpendScope,
} from "@/lib/members/commander-donation.server";
import { CommanderAccessError } from "@/lib/members/commander-access.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function parseIsoDate(raw: string | null, endOfDay: boolean): Date | null {
  if (!raw?.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return new Date(
      endOfDay ? `${raw.trim()}T23:59:59.999Z` : `${raw.trim()}T00:00:00.000Z`,
    );
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const url = new URL(request.url);
  const scopeRaw = url.searchParams.get("scope") ?? "me";
  const scope: StoreSpendScope = scopeRaw === "alliance" ? "alliance" : "me";
  const from = parseIsoDate(url.searchParams.get("from"), false);
  const to = parseIsoDate(url.searchParams.get("to"), true);
  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to dates are required (YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  try {
    const result = await listStoreSpend({
      sessionId: session.id,
      from,
      to,
      scope,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof CommanderDonationError ||
      error instanceof CommanderAccessError
    ) {
      return NextResponse.json(
        { error: error.message, code: "code" in error ? error.code : undefined },
        { status: error.status },
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const session = await getOrCreateSession();
  const url = new URL(request.url);
  const receiptId = url.searchParams.get("id")?.trim();
  if (!receiptId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    await softDeleteDonationReceipt({ sessionId: session.id, receiptId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error instanceof CommanderDonationError ||
      error instanceof CommanderAccessError
    ) {
      return NextResponse.json(
        { error: error.message, code: "code" in error ? error.code : undefined },
        { status: error.status },
      );
    }
    throw error;
  }
}
