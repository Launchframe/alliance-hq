import { NextResponse } from "next/server";

import {
  serializeDepositSlip,
  validateDepositSlipPayload,
  type DepositSlipPayload,
} from "@/lib/banks/api.shared";
import { withBankDepositCommitLock } from "@/lib/banks/bank-deposit-commit-lock.server";
import {
  findHistoricalDepositMatch,
  shouldSkipHistoricalDepositDuplicate,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-match.shared";
import { resolveDepositSlipMemberLinks } from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
import {
  createDepositSlip,
  listDepositSlipsForBank,
} from "@/lib/banks/repository.server";
import type { DepositStatus } from "@/lib/banks/types.shared";
import { reloadBankManagementDashboard } from "@/lib/banks/reload-dashboard.server";
import {
  requireBankAllianceContext,
  requireBankWrite,
} from "@/lib/banks/route-helpers.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await requireBankAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBankWrite(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as DepositSlipPayload;
  const validationError = validateDepositSlipPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const row = await withBankDepositCommitLock(
      { allianceId, bankId: body.bankId },
      async () => {
        let payload = body;
        const needsMemberResolve =
          body.allianceMemberId == null ||
          body.commanderId == null ||
          body.depositAllianceId == null;
        if (needsMemberResolve) {
          const links = await resolveDepositSlipMemberLinks({
            bankAllianceId: allianceId,
            depositAllianceTag: body.depositAllianceTag,
            commanderName: body.commanderName,
          });
          payload = {
            ...body,
            depositAllianceId: body.depositAllianceId ?? links.depositAllianceId,
            commanderId: body.commanderId ?? links.commanderId,
            allianceMemberId: body.allianceMemberId ?? links.allianceMemberId,
          };
        }

        // Same advisory lock as OCR commits: reject history duplicates so a
        // double-submit (or manual create after OCR) cannot insert a second
        // slip the video path would have skipped.
        const existingSlips = await listDepositSlipsForBank(
          allianceId,
          payload.bankId,
        );
        const history = existingSlips.map((slip) => ({
          id: slip.id,
          commanderName: slip.commanderName,
          depositAt:
            slip.depositAt instanceof Date
              ? slip.depositAt.toISOString()
              : String(slip.depositAt),
          amount: slip.amount,
          termDays: slip.termDays,
          depositAllianceTag: slip.depositAllianceTag,
          status: slip.status as DepositStatus,
          allianceMemberId: slip.allianceMemberId ?? null,
          outcomeAt:
            slip.outcomeAt == null
              ? null
              : slip.outcomeAt instanceof Date
                ? slip.outcomeAt.toISOString()
                : String(slip.outcomeAt),
        }));
        const incoming = {
          commanderName: payload.commanderName,
          depositAt: payload.depositAt,
          amount: payload.amount,
          termDays: payload.termDays,
          depositAllianceTag: payload.depositAllianceTag ?? null,
          status: (payload.status ?? "locked") as DepositStatus,
          outcomeAt: payload.outcomeAt ?? null,
          allianceMemberId: payload.allianceMemberId ?? null,
        };
        const historicalMatch = findHistoricalDepositMatch(incoming, history);
        if (
          historicalMatch &&
          shouldSkipHistoricalDepositDuplicate(incoming, historicalMatch)
        ) {
          throw new Error("Duplicate deposit slip.");
        }

        return createDepositSlip(allianceId, payload);
      },
    );
    const dashboard = await reloadBankManagementDashboard(allianceId, sessionId);
    return NextResponse.json({
      depositSlip: serializeDepositSlip(row),
      dashboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status =
      message === "Bank not found."
        ? 404
        : message === "Duplicate deposit slip."
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
