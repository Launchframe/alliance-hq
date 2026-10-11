import { NextResponse } from "next/server";
import { z } from "zod";

import {
  loadUserLocaleState,
  setManualPreferredLocale,
} from "@/lib/i18n/user-locale.server";
import { isAppLocaleValue, USER_LOCALE_AUTOMATIC } from "@/lib/i18n/user-locale.shared";
import { requireApiSession, resolveEffectiveHqUserIdForSession } from "@/lib/session";

const patchSchema = z.object({ locale: z.string().trim().min(1) });

async function resolveHqUserId() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const hqUserId = await resolveEffectiveHqUserIdForSession(
    sessionOrError.id,
    sessionOrError.hqUserId,
  );
  if (!hqUserId) {
    return NextResponse.json(
      { error: "Reconnect to save account preferences." },
      { status: 403 },
    );
  }
  return hqUserId;
}

export async function GET() {
  const hqUserId = await resolveHqUserId();
  if (hqUserId instanceof NextResponse) return hqUserId;
  return NextResponse.json(await loadUserLocaleState(hqUserId));
}

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  const value = parsed.success ? parsed.data.locale : null;
  if (!value || (value !== USER_LOCALE_AUTOMATIC && !isAppLocaleValue(value))) {
    return NextResponse.json({ error: "Invalid locale." }, { status: 400 });
  }

  const hqUserId = await resolveHqUserId();
  if (hqUserId instanceof NextResponse) return hqUserId;

  await setManualPreferredLocale(
    hqUserId,
    value === USER_LOCALE_AUTOMATIC ? null : value,
  );
  return NextResponse.json({ ok: true, ...(await loadUserLocaleState(hqUserId)) });
}
