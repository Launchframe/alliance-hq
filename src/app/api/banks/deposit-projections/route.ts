import { NextResponse } from "next/server";

import {
  createDepositProjection,
  listDepositProjections,
} from "@/lib/banks/deposit-projections.server";
import {
  requireBankAllianceContext,
  requireBankRead,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";
import type {
  DepositFalloffScope,
  DepositProjectionCreatePayload,
} from "@/lib/banks/types.shared";
import { DEPOSIT_FALLOFF_SCOPES } from "@/lib/banks/types.shared";

export const dynamic = "force-dynamic";

function parseScope(raw: string | null): DepositFalloffScope | undefined {
  if (raw == null || raw === "") return undefined;
  return (DEPOSIT_FALLOFF_SCOPES as readonly string[]).includes(raw)
    ? (raw as DepositFalloffScope)
    : undefined;
}

export async function GET(request: Request) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const denied = await requireBankRead(auth.sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const bankId = url.searchParams.get("bankId");
  const scope = parseScope(url.searchParams.get("scope"));

  const projections = await listDepositProjections(auth.allianceId, {
    bankId: bankId || undefined,
    scope,
  });
  return NextResponse.json({ projections });
}

export async function POST(request: Request) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const denied = await requireBankWrite(auth.sessionId);
  if (denied) return denied;

  const body = (await request.json()) as DepositProjectionCreatePayload;
  try {
    const projection = await createDepositProjection(
      auth.allianceId,
      auth.session.hqUserId ?? null,
      body,
    );
    return NextResponse.json({ projection }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Bank not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
