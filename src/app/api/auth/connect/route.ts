import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { verifyBase44Connection } from "@/lib/base44/server";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
  parseConnectionInput,
} from "@/lib/connectionString";
import {
  getOrCreateSession,
  getSessionState,
  storeAshedConnection,
} from "@/lib/session";

export async function GET() {
  try {
    const locale = await getLocale();
    const state = await getSessionState(locale);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load session",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const locale = await getLocale();
    const body = (await request.json()) as {
      input?: string;
      appId?: string;
      originUrl?: string;
      expiryReminderDays?: number;
    };

    const parsed = parseConnectionInput(body.input ?? "", {
      appId: body.appId ?? DEFAULT_APP_ID,
      originUrl: body.originUrl ?? DEFAULT_ORIGIN_URL,
    });

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const me = await verifyBase44Connection(parsed.connection);
    const userLabel =
      me.email ?? me.full_name ?? me.id ?? "Connected user";

    const session = await getOrCreateSession();
    const ashed = await storeAshedConnection(
      session.id,
      parsed.connection,
      userLabel,
      {
        ...(body.expiryReminderDays !== undefined
          ? { expiryReminderDays: body.expiryReminderDays }
          : {}),
        locale,
      },
    );

    return NextResponse.json({
      ok: true,
      userLabel,
      isConnected: true,
      ashed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Connection failed. Token may be expired — copy a fresh one from Network.",
      },
      { status: 401 },
    );
  }
}
