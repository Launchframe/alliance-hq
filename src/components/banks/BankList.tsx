"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageUp, Pencil, Plus, Video } from "lucide-react";

import { Link } from "@/i18n/navigation";

import { DepositTermRiskGauges } from "@/components/banks/DepositTermRiskGauge";
import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { bankMatchesCoordQuery } from "@/lib/banks/bank-list-search.shared";
import { activeDeposits, isPastDropDeadline } from "@/lib/banks/optimization.shared";
import { resolveProtectionExpiresAt } from "@/lib/banks/protection-timer.shared";
import { computeDepositTermRiskGauges } from "@/lib/banks/risk-profile.shared";
import type { AllianceSafeTimeSlot } from "@/lib/alliance/alliance-safe-time.shared";
import type { BankWithSlips } from "@/lib/banks/types.shared";
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
  allianceSafeTimeSlot?: AllianceSafeTimeSlot | null;
  onSelect: (bankId: string) => void;
  onEdit: (bank: BankWithSlips) => void;
  onAdd: () => void;
  onImportFromScreenshot: () => void;
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

type BankListItemProps = {
  bank: BankWithSlips;
  selected: boolean;
  muted?: boolean;
  canWrite: boolean;
  allianceSafeTimeSlot: AllianceSafeTimeSlot | null;
  t: ReturnType<typeof useTranslations<"bankManagement">>;
  onSelect: (bankId: string) => void;
  onEdit: (bank: BankWithSlips) => void;
};

function BankListItem({
  bank,
  selected,
  muted = false,
  canWrite,
  allianceSafeTimeSlot,
  t,
  onSelect,
  onEdit,
}: BankListItemProps) {
  const active = activeDeposits(bank.depositSlips).length;
  const riskGauges = useMemo(
    () =>
      computeDepositTermRiskGauges({
        now: new Date(),
        protectionExpiresAt: resolveProtectionExpiresAt({
          explicit: bank.protectionExpiresAt,
          capturedAt: bank.capturedAt ? new Date(bank.capturedAt) : null,
          safeTimeSlot: allianceSafeTimeSlot,
        }),
        dropByAt: bank.dropByAt ? new Date(bank.dropByAt) : null,
        counterpartyRiskScore: bank.counterpartyRiskScore,
      }),
    [allianceSafeTimeSlot, bank],
  );

  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
          selected
            ? muted
              ? "border-hq-accent/60 bg-hq-accent/5"
              : "border-hq-accent bg-hq-accent/10"
            : muted
              ? "border-hq-fg-muted/40 bg-hq-surface/60"
              : "border-hq-border bg-hq-surface"
        }`}
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
          <DepositTermRiskGauges gauges={riskGauges} size="sm" />
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

export function BankList({
  banks,
  selectedBankId,
  canWrite,
  allianceSafeTimeSlot = null,
  onSelect,
  onEdit,
  onAdd,
  onImportFromScreenshot,
}: Props) {
  const t = useTranslations("bankManagement");
  const [coordQuery, setCoordQuery] = useState("");

  const filteredBanks = useMemo(
    () => banks.filter((bank) => bankMatchesCoordQuery(bank, coordQuery)),
    [banks, coordQuery],
  );

  const { activeBanks, pastDropBanks } = useMemo(() => {
    const active: BankWithSlips[] = [];
    const pastDrop: BankWithSlips[] = [];
    for (const bank of filteredBanks) {
      if (isPastDropDeadline(bank)) {
        pastDrop.push(bank);
      } else {
        active.push(bank);
      }
    }
    return { activeBanks: active, pastDropBanks: pastDrop };
  }, [filteredBanks]);

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

      {banks.length === 0 ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("emptyBanks")}
        </div>
      ) : filteredBanks.length === 0 && queryActive ? (
        <div className="rounded-lg border border-hq-border bg-hq-surface p-4 text-sm text-hq-fg-muted">
          {t("bankCoordSearchEmpty")}
        </div>
      ) : (
        <>
          {activeBanks.length > 0 ? (
            <ul className="space-y-2">
              {activeBanks.map((bank) => (
                <BankListItem
                  key={bank.id}
                  bank={bank}
                  selected={bank.id === selectedBankId}
                  canWrite={canWrite}
                  allianceSafeTimeSlot={allianceSafeTimeSlot}
                  t={t}
                  onSelect={onSelect}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          ) : null}

          {pastDropBanks.length > 0 ? (
            <div className="space-y-2 pt-2">
              <div>
                <h3 className="text-sm font-semibold text-hq-fg-muted">
                  {t("pastDropDeadlineTitle")}
                </h3>
                <p className="mt-0.5 text-xs text-hq-fg-subtle">
                  {t("pastDropDeadlineHint")}
                </p>
              </div>
              <ul className="space-y-2">
                {pastDropBanks.map((bank) => (
                  <BankListItem
                    key={bank.id}
                    bank={bank}
                    selected={bank.id === selectedBankId}
                    muted
                    canWrite={canWrite}
                    allianceSafeTimeSlot={allianceSafeTimeSlot}
                    t={t}
                    onSelect={onSelect}
                    onEdit={onEdit}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
