"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Pencil, Plus, Trash2, Video } from "lucide-react";

import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import type { BankWithSlips, SerializedDepositSlip } from "@/lib/banks/types.shared";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

type Props = {
  bank: BankWithSlips | null;
  canWrite: boolean;
  onAdd: () => void;
  onEdit: (slip: SerializedDepositSlip) => void;
  onDelete: (slip: SerializedDepositSlip) => void;
};

const statusBadgeClass: Record<SerializedDepositSlip["status"], string> = {
  locked: "border-hq-accent/40 bg-hq-accent/10 text-hq-accent",
  matured: "border-hq-warning/40 bg-hq-warning/10 text-hq-warning",
  looted: "border-hq-fg-muted/40 bg-hq-surface-muted text-hq-fg-muted",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function DepositSlipList({ bank, canWrite, onAdd, onEdit, onDelete }: Props) {
  const t = useTranslations("bankManagement");

  if (!bank) return null;

  const slips = [...bank.depositSlips].sort(
    (a, b) => new Date(a.depositAt).getTime() - new Date(b.depositAt).getTime(),
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold text-hq-fg">
          {t("depositsTitle")} — {t("coords", {
            server: bank.gameServerNumber,
            x: bank.coordX,
            y: bank.coordY,
          })}
        </h2>
        {canWrite ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("addDeposit")}
          </button>
        ) : null}
      </div>

      {slips.length === 0 ? (
        <div className="min-w-0 space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          <p>{t("emptyDeposits")}</p>
          {canWrite ? (
            <>
              <p className="text-xs text-hq-fg-muted">{t("emptyDepositsHint")}</p>
              <Link
                href={buildVideoUploadHref(BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET, {
                  bankId: bank.id,
                })}
                className="inline-flex items-center gap-1.5 rounded border border-hq-accent px-3 py-1.5 text-xs font-medium text-hq-accent hover:bg-hq-accent/10"
              >
                <Video className="h-3.5 w-3.5" aria-hidden />
                {t("uploadDepositSlip")}
              </Link>
            </>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {slips.map((slip) => (
            <li
              key={slip.id}
              className="flex items-center gap-2 rounded-lg border border-hq-border bg-hq-surface p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-hq-fg">
                    {slip.amount.toLocaleString()}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass[slip.status]}`}
                  >
                    {t(`status.${slip.status}`)}
                  </span>
                  <span className="text-xs text-hq-fg-muted">
                    {slip.termDays}d
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-hq-fg-muted">
                  <span>{formatDateTime(slip.depositAt)}</span>
                  <span>→ {formatDateTime(slip.maturesAt)}</span>
                  <span>{slip.commanderName}</span>
                  {slip.depositAllianceTag ? (
                    <span>[{slip.depositAllianceTag}]</span>
                  ) : null}
                </div>
              </div>
              {canWrite ? (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={t("editDeposit")}
                    className="rounded border border-hq-border p-2 text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
                    onClick={() => onEdit(slip)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t("deleteDeposit")}
                    className="rounded border border-hq-border p-2 text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger"
                    onClick={() => onDelete(slip)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
