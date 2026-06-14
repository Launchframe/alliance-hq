import { NextResponse } from "next/server";

import {
  AllianceSelectionError,
  allianceSelectionErrorStatus,
  listAccessibleAlliances,
} from "@/lib/alliance/connect-alliance";
import { verifyBase44Connection } from "@/lib/base44/server";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
  parseConnectionInput,
} from "@/lib/connectionString";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      input?: string;
      appId?: string;
      originUrl?: string;
    };

    const parsed = parseConnectionInput(body.input ?? "", {
      appId: body.appId ?? DEFAULT_APP_ID,
      originUrl: body.originUrl ?? DEFAULT_ORIGIN_URL,
    });

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const me = await verifyBase44Connection(parsed.connection);
    if (!me.email) {
      return NextResponse.json(
        { error: "Ashed account email is required to list alliances." },
        { status: 502 },
      );
    }

    const alliances = await listAccessibleAlliances(parsed.connection, {
      email: me.email,
      id: me.id,
    });

    return NextResponse.json({
      alliances,
      autoSelected: alliances.length === 1 ? alliances[0] : null,
    });
  } catch (error) {
    if (error instanceof AllianceSelectionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: allianceSelectionErrorStatus(error.code) },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list accessible alliances.",
      },
      { status: 401 },
    );
  }
}
