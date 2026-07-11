"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Video } from "lucide-react";

import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { activeDeposits } from "@/lib/banks/optimization.shared";
import type { BankWithSlips } from "@/lib/banks/types.shared";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

function depositSlipUploadHref(bankId: string): string {
  return buildVideoUploadHref(BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET, {
    bankId,
  });
}

type Props = {
  banks: BankWithSlips[];
  selectedBankId: string | null;
  canWrite: boolean;
  onSelect: (bankId: string) => void;
  onEdit: (bank: BankWithSlips) => void;
  onAdd: () => void;
};

function policyLabel(
  policy: BankWithSlips["depositPolicy"],
  t: ReturnType<typeof useTranslations>,
): string {
  if (policy === "alliance") return t("policyAlliance");
  if (policy === "warzone") return t("policyWarzone");
  if (policy === "public") return t("policyPublic");
  return t("policyUnset");
}

export function BankList({
  banks,
  selectedBankId,
  canWrite,
  onSelect,
  onEdit,
  onAdd,
}: Props) {
  const t = useTranslations("bankManagement");

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="min-w-0 text-sm font-semibold text-hq-fg">{t("banksTitle")}</h2>
        {canWrite ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("addBank")}
          </button>
        ) : null}
      </div>

      {banks.length === 0 ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("emptyBanks")}
        </div>
      ) : (
        <ul className="space-y-2">
          {banks.map((bank) => {
            const selected = bank.id === selectedBankId;
            const active = activeDeposits(bank.depositSlips).length;
            return (
              <li key={bank.id}>
                <div
                  className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
                    selected
                      ? "border-hq-accent bg-hq-accent/10"
                      : "border-hq-border bg-hq-surface"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(bank.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-hq-fg">
                        {t("coords", {
                          server: bank.gameServerNumber,
                          x: bank.coordX,
                          y: bank.coordY,
                        })}
                      </span>
                      <span className="rounded-full border border-hq-border px-2 py-0.5 text-xs text-hq-fg-muted">
                        {t("level", { level: bank.level })}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-hq-fg-muted">
                      <span>{policyLabel(bank.depositPolicy, t)}</span>
                      <span>
                        {t("depositsTitle")}: {active}/{bank.depositSlips.length}
                      </span>
                      {bank.dropByAt ? (
                        <span>
                          {t("fields.dropByAt")}:{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(bank.dropByAt))}
                        </span>
                      ) : null}
                    </div>
                    {bank.notes ? (
                      <p className="mt-1 truncate text-xs text-hq-fg-subtle">
                        {bank.notes}
                      </p>
                    ) : null}
                  </button>
                  {canWrite ? (
                    <Link
                      href={depositSlipUploadHref(bank.id)}
                      aria-label={t("uploadDepositSlip")}
                      title={t("uploadDepositSlip")}
                      className="shrink-0 rounded border border-hq-border p-2 text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
                    >
                      <Video className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  ) : null}
                  {canWrite ? (
                    <button
                      type="button"
                      aria-label={t("editBank")}
                      className="shrink-0 rounded border border-hq-border p-2 text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
                      onClick={() => onEdit(bank)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
