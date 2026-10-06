import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/session";
import {
  loadNavigationPreferences,
  recordNavigationVisit,
  setShowAshedPages,
  toggleNavigationFavorite,
} from "@/lib/nav/preferences.server";

const toggleFavoriteSchema = z.object({
  destinationId: z.string().min(1),
});

const showAshedSchema = z.object({
  showAshedPages: z.boolean(),
});

const visitSchema = z.object({
  destinationId: z.string().min(1),
});

async function requireAuthenticatedHqUser() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) {
    return { errorResponse: session };
  }
  if (!session.hqUserId) {
    return {
      errorResponse: NextResponse.json(
        { error: "HQ user binding required" },
        { status: 401 },
      ),
    };
  }
  return { hqUserId: session.hqUserId };
}

export async function GET() {
  const result = await requireAuthenticatedHqUser();
  if ("errorResponse" in result) {
    return result.errorResponse;
  }

  const preferences = await loadNavigationPreferences(result.hqUserId);
  return NextResponse.json(preferences);
}

export async function POST(request: Request) {
  const result = await requireAuthenticatedHqUser();
  if ("errorResponse" in result) {
    return result.errorResponse;
  }

  const body = await request.json();
  const parsed = toggleFavoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const updated = await toggleNavigationFavorite(
    result.hqUserId,
    parsed.data.destinationId,
  );
  return NextResponse.json(updated);
}

export async function PATCH(request: Request) {
  const result = await requireAuthenticatedHqUser();
  if ("errorResponse" in result) {
    return result.errorResponse;
  }

  const body = await request.json();
  const parsed = showAshedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await setShowAshedPages(result.hqUserId, parsed.data.showAshedPages);
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const result = await requireAuthenticatedHqUser();
  if ("errorResponse" in result) {
    return result.errorResponse;
  }

  const body = await request.json();
  const parsed = visitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await recordNavigationVisit(result.hqUserId, parsed.data.destinationId);
  return NextResponse.json({ ok: true });
}
