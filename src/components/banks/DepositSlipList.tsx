"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Check, Copy, Pencil, Plus, Trash2, Video } from "lucide-react";

import { AppSelect } from "@/components/ui/AppSelect";
import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import {
  DEPOSIT_ALLIANCE_FILTER_ALL,
  DEPOSIT_ALLIANCE_FILTER_UNTAGGED,
  buildDepositAllianceSummary,
  filterSlipsByDepositAlliance,
  formatDepositAllianceReportPlaintext,
  resolveDepositAllianceFilter,
  uniqueDepositAllianceTags,
  type DepositAllianceFilter,
} from "@/lib/banks/deposit-alliance-report.shared";
import {
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type BankWithSlips,
  type SerializedDepositSlip,
} from "@/lib/banks/types.shared";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
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
  return formatBrowserLocalDateTime(iso, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function DepositSlipList({ bank, canWrite, onAdd, onEdit, onDelete }: Props) {
  const t = useTranslations("bankManagement");
  const [allianceFilter, setAllianceFilter] = useState<DepositAllianceFilter>(
    DEPOSIT_ALLIANCE_FILTER_ALL,
  );
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tags = useMemo(
    () => (bank ? uniqueDepositAllianceTags(bank.depositSlips) : []),
    [bank],
  );

  // Drop a stale tag selection without setState-in-effect (React Compiler).
  // Rematch case-insensitively so OCR casing drift does not reset to All.
  const resolvedFilter = resolveDepositAllianceFilter(allianceFilter, tags);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const filterOptions = useMemo(
    () => [
      { value: DEPOSIT_ALLIANCE_FILTER_ALL, label: t("filterAllianceAll") },
      {
        value: DEPOSIT_ALLIANCE_FILTER_UNTAGGED,
        label: t("filterAllianceUntagged"),
      },
      ...tags.map((tag) => ({ value: tag, label: `[${tag}]` })),
    ],
    [t, tags],
  );

  const filteredSlips = useMemo(() => {
    if (!bank) return [];
    return filterSlipsByDepositAlliance(bank.depositSlips, resolvedFilter).sort(
      (a, b) => new Date(a.depositAt).getTime() - new Date(b.depositAt).getTime(),
    );
  }, [bank, resolvedFilter]);

  const summary = useMemo(
    () => buildDepositAllianceSummary(filteredSlips),
    [filteredSlips],
  );

  if (!bank) return null;

  const bankLabel = t("coords", {
    server: bank.gameServerNumber,
    x: bank.coordX,
    y: bank.coordY,
  });

  const allianceFilterLabel =
    resolvedFilter === DEPOSIT_ALLIANCE_FILTER_ALL
      ? t("filterAllianceAll")
      : resolvedFilter === DEPOSIT_ALLIANCE_FILTER_UNTAGGED
        ? t("filterAllianceUntagged")
        : `[${resolvedFilter}]`;

  async function handleCopyReport() {
    const text = formatDepositAllianceReportPlaintext({
      bankLabel,
      allianceFilterLabel,
      slips: filteredSlips,
      summary,
      statusLabel: (status) => t(`status.${status}`),
      formatAmount: (n) => n.toLocaleString(),
      formatDateTime,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — leave button label unchanged.
    }
  }

  const showFilterControls = bank.depositSlips.length > 0;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold text-hq-fg">
          {t("depositsTitle")} — {bankLabel}
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

      {showFilterControls ? (
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <label className="min-w-[10rem] flex-1 space-y-1 text-xs text-hq-fg-muted">
            <span>{t("filterAlliance")}</span>
            <AppSelect
              value={resolvedFilter}
              onChange={setAllianceFilter}
              options={filterOptions}
              aria-label={t("filterAlliance")}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleCopyReport()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-hq-border px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-surface-muted"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-hq-green" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
            {copied ? t("copiedReport") : t("copyReport")}
          </button>
        </div>
      ) : null}

      {showFilterControls ? (
        <div className="space-y-2 rounded-lg border border-hq-border bg-hq-surface p-3 text-xs text-hq-fg-muted">
          <p className="font-medium text-hq-fg">{t("reportTitle")}</p>
          <p>
            {t("reportTotals", {
              count: summary.total.count,
              amount: summary.total.amount.toLocaleString(),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="text-hq-fg-muted">{t("reportByTerm")}</span>
            {DEPOSIT_TERMS.map((term) => (
              <span
                key={term}
                className="rounded-full border border-hq-border px-2 py-0.5"
              >
                {term}d · {summary.byTerm[term].count} ·{" "}
                {summary.byTerm[term].amount.toLocaleString()}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-hq-fg-muted">{t("reportByStatus")}</span>
            {DEPOSIT_STATUSES.map((status) => (
              <span
                key={status}
                className={`rounded-full border px-2 py-0.5 ${statusBadgeClass[status]}`}
              >
                {t(`status.${status}`)} · {summary.byStatus[status].count} ·{" "}
                {summary.byStatus[status].amount.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {bank.depositSlips.length === 0 ? (
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
      ) : filteredSlips.length === 0 ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("emptyFilteredDeposits")}
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredSlips.map((slip) => (
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
