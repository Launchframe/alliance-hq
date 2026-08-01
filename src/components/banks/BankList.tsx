"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageUp, Pencil, Plus, Video } from "lucide-react";

import { Link } from "@/i18n/navigation";

import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { bankMatchesCoordQuery } from "@/lib/banks/bank-list-search.shared";
import {
  type BankLifecycleStage,
  resolveBankLifecycleStage,
} from "@/lib/banks/bank-lifecycle.shared";
import { activeDeposits } from "@/lib/banks/optimization.shared";
import type {
  BankPendingDepositSlipVideoReview,
  BankWithSlips,
} from "@/lib/banks/types.shared";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
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
  pendingDepositSlipVideoReviewsByBankId?: Record<
    string,
    BankPendingDepositSlipVideoReview
  >;
  onSelect: (bankId: string) => void;
  onEdit: (bank: BankWithSlips) => void;
  onAdd: () => void;
  onImportFromScreenshot: () => void;
};

const LIFECYCLE_TABS: BankLifecycleStage[] = [
  "active",
  "dropping_soon",
  "abandoned",
];

function policyLabel(
  policy: BankWithSlips["depositPolicy"],
  t: ReturnType<typeof useTranslations>,
): string {
  if (policy === "alliance") return t("policyAlliance");
  if (policy === "warzone") return t("policyWarzone");
  if (policy === "public") return t("policyPublic");
  return t("policyUnset");
}

function lifecycleRowClasses(
  stage: BankLifecycleStage,
  selected: boolean,
): string {
  if (selected) {
    if (stage === "dropping_soon") {
      return "border-hq-warning/60 bg-hq-warning/15";
    }
    if (stage === "abandoned") {
      return "border-hq-fg-muted/50 bg-hq-fg-muted/10";
    }
    return "border-hq-accent bg-hq-accent/10";
  }
  if (stage === "dropping_soon") {
    return "border-hq-warning/40 bg-hq-warning/10";
  }
  if (stage === "abandoned") {
    return "border-hq-fg-muted/40 bg-hq-surface/60";
  }
  return "border-hq-border bg-hq-surface";
}

type BankListItemProps = {
  bank: BankWithSlips;
  stage: BankLifecycleStage;
  selected: boolean;
  canWrite: boolean;
  pendingReview: BankPendingDepositSlipVideoReview | null;
  t: ReturnType<typeof useTranslations<"bankManagement">>;
  onSelect: (bankId: string) => void;
  onEdit: (bank: BankWithSlips) => void;
};

function BankListItem({
  bank,
  stage,
  selected,
  canWrite,
  pendingReview,
  t,
  onSelect,
  onEdit,
}: BankListItemProps) {
  const active = activeDeposits(bank.depositSlips).length;
  const muted = stage === "abandoned";

  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${lifecycleRowClasses(stage, selected)}`}
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelect(bank.id)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`font-medium ${muted ? "text-hq-fg-muted" : "text-hq-fg"}`}
            >
              {t("coords", {
                server: bank.gameServerNumber,
                x: bank.coordX,
                y: bank.coordY,
              })}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${
                muted
                  ? "border-hq-fg-muted/40 text-hq-fg-subtle"
                  : "border-hq-border text-hq-fg-muted"
              }`}
            >
              {t("level", { level: bank.level })}
            </span>
          </div>
          <div
            className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${
              muted ? "text-hq-fg-subtle" : "text-hq-fg-muted"
            }`}
          >
            <span>{policyLabel(bank.depositPolicy, t)}</span>
            <span>
              {t("depositsTitle")}: {active}/{bank.depositSlips.length}
            </span>
            {pendingReview ? (
              <Link
                href={`/tools/video-upload/${pendingReview.firstJobId}/review`}
                className={`rounded-full border px-2 py-0.5 font-medium hover:border-hq-accent ${
                  muted
                    ? "border-hq-warning/50 text-hq-warning/80"
                    : "border-hq-warning/70 bg-hq-warning/10 text-hq-warning"
                }`}
                aria-label={t("reviewPendingDepositSlipVideo")}
                onClick={(event) => event.stopPropagation()}
              >
                {t("pendingDepositSlipVideoReview", {
                  count: pendingReview.count,
                })}
              </Link>
            ) : null}
            {bank.dropByAt ? (
              <span>
                {t("fields.dropByAt")}:{" "}
                {formatBrowserLocalDateTime(bank.dropByAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            ) : null}
          </div>
          {bank.notes ? (
            <p
              className={`mt-1 line-clamp-2 text-xs ${
                muted ? "text-hq-fg-subtle" : "text-hq-fg-muted"
              }`}
            >
              {bank.notes}
            </p>
          ) : null}
        </button>
        <div className="flex shrink-0 flex-col gap-1">
          {canWrite ? (
            <button
              type="button"
              className="rounded border border-hq-border p-1.5 text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
              aria-label={t("editBank")}
              onClick={() => onEdit(bank)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <Link
            href={depositSlipUploadHref(bank.id)}
            className="rounded border border-hq-border p-1.5 text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
            aria-label={t("uploadDepositSlip")}
          >
            <Video className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </li>
  );
}

function lifecycleTabLabel(
  stage: BankLifecycleStage,
  t: ReturnType<typeof useTranslations<"bankManagement">>,
): string {
  if (stage === "active") return t("bankLifecycleTabActive");
  if (stage === "dropping_soon") return t("bankLifecycleTabDroppingSoon");
  return t("bankLifecycleTabAbandoned");
}

export function BankList({
  banks,
  selectedBankId,
  canWrite,
  pendingDepositSlipVideoReviewsByBankId = {},
  onSelect,
  onEdit,
  onAdd,
  onImportFromScreenshot,
}: Props) {
  const t = useTranslations("bankManagement");
  const [coordQuery, setCoordQuery] = useState("");
  const [lifecycleTab, setLifecycleTab] = useState<BankLifecycleStage>("active");

  const filteredBanks = useMemo(
    () => banks.filter((bank) => bankMatchesCoordQuery(bank, coordQuery)),
    [banks, coordQuery],
  );

  const banksByLifecycle = useMemo(() => {
    const grouped: Record<BankLifecycleStage, BankWithSlips[]> = {
      active: [],
      dropping_soon: [],
      abandoned: [],
    };
    for (const bank of filteredBanks) {
      const stage = resolveBankLifecycleStage(bank);
      grouped[stage].push(bank);
    }
    return grouped;
  }, [filteredBanks]);

  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        LIFECYCLE_TABS.map((tab) => [tab, banksByLifecycle[tab].length]),
      ) as Record<BankLifecycleStage, number>,
    [banksByLifecycle],
  );

  const visibleBanks = banksByLifecycle[lifecycleTab];
  const queryActive = coordQuery.trim().length > 0;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 text-sm font-semibold text-hq-fg">
          {t("banksTitle")}
        </h2>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-hq-border px-3 py-1.5 text-xs font-medium text-hq-fg hover:border-hq-accent"
              onClick={onImportFromScreenshot}
            >
              <ImageUp className="h-3.5 w-3.5" aria-hidden />
              {t("importBanksFromScreenshot")}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white"
              onClick={onAdd}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("addBank")}
            </button>
          </div>
        ) : null}
      </div>

      {banks.length > 0 ? (
        <label className="block space-y-1">
          <span className="sr-only">{t("bankCoordSearchPlaceholder")}</span>
          <input
            type="search"
            value={coordQuery}
            onChange={(event) => setCoordQuery(event.target.value)}
            placeholder={t("bankCoordSearchPlaceholder")}
            className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg placeholder:text-hq-fg-subtle"
            data-testid="bank-coord-search"
          />
        </label>
      ) : null}

      {banks.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label={t("banksTitle")}
        >
          {LIFECYCLE_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={lifecycleTab === tab}
              className={
                lifecycleTab === tab
                  ? "rounded-md border border-hq-accent bg-hq-accent/10 px-3 py-1.5 text-xs font-medium text-hq-fg"
                  : "rounded-md border border-hq-border px-3 py-1.5 text-xs text-hq-fg-muted hover:border-hq-accent hover:text-hq-fg"
              }
              onClick={() => setLifecycleTab(tab)}
            >
              {lifecycleTabLabel(tab, t)} ({tabCounts[tab]})
            </button>
          ))}
        </div>
      ) : null}

      {banks.length === 0 ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("emptyBanks")}
        </div>
      ) : filteredBanks.length === 0 && queryActive ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("bankCoordSearchEmpty")}
        </div>
      ) : visibleBanks.length === 0 ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("bankLifecycleTabEmpty")}
        </div>
      ) : (
        <ul className="space-y-2" role="tabpanel">
          {visibleBanks.map((bank) => (
            <BankListItem
              key={bank.id}
              bank={bank}
              stage={lifecycleTab}
              selected={bank.id === selectedBankId}
              canWrite={canWrite}
              pendingReview={
                pendingDepositSlipVideoReviewsByBankId[bank.id] ?? null
              }
              t={t}
              onSelect={onSelect}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
