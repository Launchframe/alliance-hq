import { NextResponse } from "next/server";

import {
  CommanderDonationError,
  createOrRotateTipLink,
  getActiveTipLinkForSession,
  revokeActiveTipLink,
} from "@/lib/members/commander-donation.server";
import { CommanderAccessError } from "@/lib/members/commander-access.server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  try {
    const tip = await getActiveTipLinkForSession(session.id);
    return NextResponse.json({ tip });
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

export async function POST() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  try {
    const tip = await createOrRotateTipLink({ sessionId: session.id });
    return NextResponse.json(tip);
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

export async function DELETE() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  try {
    await revokeActiveTipLink(session.id);
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
