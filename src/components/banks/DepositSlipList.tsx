"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Pencil, Plus, Trash2, Video } from "lucide-react";

import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import {
  computeDepositStats,
  depositSlipDisplayStatus,
  type DepositDisplayStatus,
} from "@/lib/banks/optimization.shared";
import type { BankWithSlips, SerializedDepositSlip } from "@/lib/banks/types.shared";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

type Props = {
  bank: BankWithSlips | null;
  canWrite: boolean;
  onAdd: () => void;
  onEdit: (slip: SerializedDepositSlip) => void;
  onDelete: (slip: SerializedDepositSlip) => void;
};

const statusBadgeClass: Record<DepositDisplayStatus, string> = {
  locked: "border-hq-accent/40 bg-hq-accent/10 text-hq-accent",
  matured: "border-hq-warning/40 bg-hq-warning/10 text-hq-warning",
  looted: "border-hq-fg-muted/40 bg-hq-surface-muted text-hq-fg-muted",
  term_elapsed: "border-hq-purple/40 bg-hq-purple/10 text-hq-purple",
};

type DepositFilter = "active" | "elapsed" | "matured" | "looted";
const DEPOSIT_FILTERS: DepositFilter[] = ["active", "elapsed", "matured", "looted"];

function formatDateTime(iso: string): string {
  return formatBrowserLocalDateTime(iso, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function StatCard({
  label,
  value,
  colorClass,
  unavailableHint,
}: {
  label: string;
  value: number | null;
  colorClass?: string;
  unavailableHint?: string;
}) {
  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface p-3">
      <p className="text-xs text-hq-fg-muted">{label}</p>
      {value != null ? (
        <p className={`mt-1 text-lg font-semibold tabular-nums ${colorClass ?? "text-hq-fg"}`}>
          {value.toLocaleString()}
        </p>
      ) : (
        <p className="mt-1 text-sm text-hq-fg-muted" title={unavailableHint}>
          —
        </p>
      )}
    </div>
  );
}

export function DepositSlipList({ bank, canWrite, onAdd, onEdit, onDelete }: Props) {
  const t = useTranslations("bankManagement");
  const [filter, setFilter] = useState<DepositFilter>("active");

  const annotatedSlips = useMemo(() => {
    if (!bank) return [];
    return bank.depositSlips.map((slip) => ({
      slip,
      displayStatus: depositSlipDisplayStatus(slip),
    }));
  }, [bank]);

  const counts = useMemo(() => {
    const result: Record<DepositFilter, number> = {
      active: 0,
      elapsed: 0,
      matured: 0,
      looted: 0,
    };
    for (const { slip, displayStatus } of annotatedSlips) {
      if (displayStatus === "locked") result.active += 1;
      else if (displayStatus === "term_elapsed") result.elapsed += 1;
      else if (slip.status === "matured") result.matured += 1;
      else if (slip.status === "looted") result.looted += 1;
    }
    return result;
  }, [annotatedSlips]);

  const visibleSlips = useMemo(() => {
    const filtered = annotatedSlips.filter(({ slip, displayStatus }) => {
      switch (filter) {
        case "active":
          return displayStatus === "locked";
        case "elapsed":
          return displayStatus === "term_elapsed";
        case "matured":
          return slip.status === "matured";
        case "looted":
          return slip.status === "looted";
        default:
          return false;
      }
    });

    if (filter === "active" || filter === "elapsed") {
      return filtered.sort(
        (a, b) => new Date(a.slip.maturesAt).getTime() - new Date(b.slip.maturesAt).getTime(),
      );
    }

    return filtered.sort((a, b) => {
      const aOutcome = a.slip.outcomeAt ? new Date(a.slip.outcomeAt).getTime() : null;
      const bOutcome = b.slip.outcomeAt ? new Date(b.slip.outcomeAt).getTime() : null;
      if (aOutcome !== bOutcome) {
        if (aOutcome == null) return 1;
        if (bOutcome == null) return -1;
        return bOutcome - aOutcome;
      }
      return new Date(b.slip.maturesAt).getTime() - new Date(a.slip.maturesAt).getTime();
    });
  }, [annotatedSlips, filter]);

  const stats = useMemo(() => {
    if (!bank) return null;
    return computeDepositStats(bank.depositSlips);
  }, [bank]);

  if (!bank) return null;

  const hasSlips = bank.depositSlips.length > 0;

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

      {!hasSlips ? (
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
        <>
          {stats ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatCard label={t("stats.totalDeposited")} value={stats.totalDeposited} />
              <StatCard
                label={t("stats.recovered")}
                value={stats.totalRecovered}
                colorClass="text-hq-success"
              />
              <StatCard
                label={t("stats.lostToLooting")}
                value={stats.totalLooted}
                colorClass="text-hq-danger"
              />
              <StatCard
                label={t("stats.interestEarned")}
                value={stats.interestEarned}
                colorClass="text-hq-success"
                unavailableHint={t("stats.interestUnavailable")}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {DEPOSIT_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? "border-hq-accent bg-hq-accent text-white"
                    : "border-hq-pill-border bg-hq-pill text-hq-pill-fg hover:border-hq-accent hover:text-hq-accent"
                }`}
              >
                {t(`filter.${f}`)}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    filter === f ? "bg-white/20 text-white" : "bg-hq-surface-muted text-hq-fg-muted"
                  }`}
                >
                  {counts[f]}
                </span>
              </button>
            ))}
          </div>

          {visibleSlips.length === 0 ? (
            <p className="text-sm text-hq-fg-muted py-4 text-center">
              {t(`filter.empty.${filter}`)}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleSlips.map(({ slip, displayStatus }) => (
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
                        className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass[displayStatus]}`}
                      >
                        {t(`status.${displayStatus}`)}
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
        </>
      )}
    </div>
  );
}
