import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { serializeBank, serializeDepositSlip } from "@/lib/banks/api.shared";
import { computeBankDropSummary } from "@/lib/banks/drop-summary.shared";
import {
  sendBankDropDiscordNotification,
  sendBankDropEmailNotification,
} from "@/lib/banks/drop-notifications.server";
import { deleteBank } from "@/lib/banks/repository.server";
import { reloadBankManagementDashboard } from "@/lib/banks/reload-dashboard.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireBankAllianceContext();
  if ("error" in auth && auth.error) {
    return auth.error;
  }

  const { sessionId, allianceId } = auth;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  const { id: bankId } = await context.params;
  const db = getDb();

  const [bank] = await db
    .select()
    .from(schema.banks)
    .where(
      and(eq(schema.banks.id, bankId), eq(schema.banks.allianceId, allianceId)),
    )
    .limit(1);

  if (!bank) {
    return NextResponse.json({ error: "Bank not found." }, { status: 404 });
  }

  const slipRows = await db
    .select()
    .from(schema.bankDepositSlips)
    .where(eq(schema.bankDepositSlips.bankId, bankId));

  const serializedBank = serializeBank(bank);
  const serializedSlips = slipRows.map(serializeDepositSlip);
  const summary = computeBankDropSummary(serializedBank, serializedSlips);

  const [discord, email] = await Promise.allSettled([
    sendBankDropDiscordNotification(allianceId, summary),
    sendBankDropEmailNotification(allianceId, summary),
  ]);

  await deleteBank(allianceId, bankId);
  const dashboard = await reloadBankManagementDashboard(allianceId, sessionId);

  return NextResponse.json({
    summary,
    dashboard,
    notifications: {
      discord:
        discord.status === "fulfilled" ? discord.value : { posted: 0 },
      email: email.status === "fulfilled" ? email.value : { sent: false },
    },
  });
}
