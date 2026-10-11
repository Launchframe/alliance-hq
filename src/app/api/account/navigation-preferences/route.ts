import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/session";
import {
  isFavoriteableDestination,
  loadNavigationPreferences,
  recordNavigationVisit,
  setShowAshedPages,
  toggleNavigationFavorite,
} from "@/lib/nav/preferences.server";

const destinationIdSchema = z.string().min(1).max(128);

const toggleFavoriteSchema = z.object({
  destinationId: destinationIdSchema,
});

const showAshedSchema = z.object({
  showAshedPages: z.boolean(),
});

const visitSchema = z.object({
  destinationId: destinationIdSchema,
});

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function invalidRequest() {
  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}

async function requireAuthenticatedHqUser(): Promise<
  { errorResponse: NextResponse } | { hqUserId: string }
> {
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

  const parsed = toggleFavoriteSchema.safeParse(await readJsonBody(request));
  if (
    !parsed.success ||
    !isFavoriteableDestination(parsed.data.destinationId)
  ) {
    return invalidRequest();
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

  const parsed = showAshedSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return invalidRequest();
  }

  await setShowAshedPages(result.hqUserId, parsed.data.showAshedPages);
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const result = await requireAuthenticatedHqUser();
  if ("errorResponse" in result) {
    return result.errorResponse;
  }

  const parsed = visitSchema.safeParse(await readJsonBody(request));
  if (
    !parsed.success ||
    !isFavoriteableDestination(parsed.data.destinationId)
  ) {
    return invalidRequest();
  }

  await recordNavigationVisit(result.hqUserId, parsed.data.destinationId);
  return NextResponse.json({ ok: true });
}
