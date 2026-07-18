import { NextResponse } from "next/server";

import {
  CommanderDonationError,
  createDonationReceipt,
} from "@/lib/members/commander-donation.server";
import { CommanderAccessError } from "@/lib/members/commander-access.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ ashedMemberId: string }>;
};

function parsePurchasedAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  // Accept YYYY-MM-DD as local calendar day → UTC noon
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return new Date(`${raw.trim()}T12:00:00.000Z`);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAmountCents(body: {
  amountCents?: unknown;
  amountUsd?: unknown;
}): number | null {
  if (typeof body.amountCents === "number" && Number.isInteger(body.amountCents)) {
    return body.amountCents;
  }
  if (typeof body.amountUsd === "number" && Number.isFinite(body.amountUsd)) {
    return Math.round(body.amountUsd * 100);
  }
  if (typeof body.amountUsd === "string" && body.amountUsd.trim()) {
    const n = Number(body.amountUsd.trim());
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const { ashedMemberId } = await context.params;

  let body: { amountCents?: unknown; amountUsd?: unknown; purchasedAt?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const amountCents = parseAmountCents(body);
  const purchasedAt = parsePurchasedAt(body.purchasedAt);
  if (amountCents == null || amountCents <= 0) {
    return NextResponse.json({ error: "Invalid amount.", code: "invalid_amount" }, { status: 400 });
  }
  if (!purchasedAt) {
    return NextResponse.json(
      { error: "Invalid purchase date.", code: "invalid_date" },
      { status: 400 },
    );
  }

  try {
    const result = await createDonationReceipt({
      sessionId: session.id,
      ashedMemberId: ashedMemberId.trim(),
      amountCents,
      purchasedAt,
      note: typeof body.note === "string" ? body.note : null,
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
