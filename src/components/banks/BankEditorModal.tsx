"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { DepositTermRiskGauges } from "@/components/banks/DepositTermRiskGauge";
import { Dialog } from "@/components/ui/dialog";
import { AppSelect } from "@/components/ui/AppSelect";
import { Textarea } from "@/components/ui/textarea";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/components/banks/datetime-local";
import type { AllianceSafeTimeSlot } from "@/lib/alliance/alliance-safe-time.shared";
import type { BankPayload } from "@/lib/banks/api.shared";
import { resolveProtectionExpiresAt } from "@/lib/banks/protection-timer.shared";
import {
  computeDepositTermRiskGauges,
  shouldShowRiskReconfirmHint,
} from "@/lib/banks/risk-profile.shared";
import { riskIntensityColor } from "@/lib/banks/risk-color.shared";
import {
  DEPOSIT_POLICIES,
  type DepositPolicy,
  type SerializedBank,
} from "@/lib/banks/types.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";

type BankFormValues = {
  gameServerNumber: string;
  coordX: string;
  coordY: string;
  level: string;
  depositPolicy: DepositPolicy;
  priorCaptureCount: string;
  capturedAt: string;
  dropByAt: string;
  notes: string;
  counterpartyRiskScore: string;
};

function buildInitialValues(
  initial: SerializedBank | null | undefined,
  defaultGameServerNumber: number | null | undefined,
): BankFormValues {
  if (!initial) {
    return {
      gameServerNumber:
        defaultGameServerNumber != null ? String(defaultGameServerNumber) : "",
      coordX: "",
      coordY: "",
      level: "",
      depositPolicy: "alliance",
      priorCaptureCount: "0",
      capturedAt: "",
      dropByAt: "",
      notes: "",
      counterpartyRiskScore: "",
    };
  }
  return {
    gameServerNumber: String(initial.gameServerNumber),
    coordX: String(initial.coordX),
    coordY: String(initial.coordY),
    level: String(initial.level),
    depositPolicy: initial.depositPolicy ?? "alliance",
    priorCaptureCount: String(initial.priorCaptureCount ?? 0),
    capturedAt: toDatetimeLocalValue(initial.capturedAt),
    dropByAt: toDatetimeLocalValue(initial.dropByAt),
    notes: initial.notes ?? "",
    counterpartyRiskScore:
      initial.counterpartyRiskScore != null
        ? String(initial.counterpartyRiskScore)
        : "",
  };
}

type Props = {
  open: boolean;
  initial?: SerializedBank | null;
  defaultGameServerNumber?: number | null;
  allianceSafeTimeSlot?: AllianceSafeTimeSlot | null;
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: BankPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
};

export function BankEditorModal({
  open,
  initial,
  defaultGameServerNumber,
  allianceSafeTimeSlot = null,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const t = useTranslations("bankManagement");
  const tRisk = useTranslations("bankManagement.riskProfile");
  const [values, setValues] = useState<BankFormValues>(() =>
    buildInitialValues(initial, defaultGameServerNumber),
  );

  const capturedAtIso = fromDatetimeLocalValue(values.capturedAt);
  const dropByAtIso = fromDatetimeLocalValue(values.dropByAt);
  const counterpartyRiskScore =
    values.counterpartyRiskScore.trim() === ""
      ? null
      : Number(values.counterpartyRiskScore);

  const protectionExpiresAt = useMemo(
    () =>
      resolveProtectionExpiresAt({
        explicit: null,
        capturedAt: capturedAtIso ? new Date(capturedAtIso) : null,
        safeTimeSlot: allianceSafeTimeSlot,
      }),
    [allianceSafeTimeSlot, capturedAtIso],
  );

  const riskGauges = useMemo(
    () =>
      computeDepositTermRiskGauges({
        now: new Date(),
        protectionExpiresAt,
        dropByAt: dropByAtIso ? new Date(dropByAtIso) : null,
        counterpartyRiskScore,
      }),
    [counterpartyRiskScore, dropByAtIso, protectionExpiresAt],
  );

  const showReconfirm = shouldShowRiskReconfirmHint({
    protectionExpiresAt,
    capturedAt: capturedAtIso ? new Date(capturedAtIso) : null,
    counterpartyRiskUpdatedAt: initial?.counterpartyRiskUpdatedAt
      ? new Date(initial.counterpartyRiskUpdatedAt)
      : null,
  });

  if (!open) return null;

  const handleSubmit = () => {
    const payload: BankPayload = {
      gameServerNumber: Number(values.gameServerNumber),
      coordX: Number(values.coordX),
      coordY: Number(values.coordY),
      level: Number(values.level),
      depositPolicy: values.depositPolicy,
      priorCaptureCount: values.priorCaptureCount
        ? Number(values.priorCaptureCount)
        : 0,
      capturedAt: capturedAtIso,
      dropByAt: dropByAtIso,
      notes: values.notes.trim() || null,
      currentDepositCount: initial?.currentDepositCount ?? null,
      currentDepositValue: initial?.currentDepositValue ?? null,
      counterpartyRiskScore,
    };
    void onSubmit(payload);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={initial ? t("editBank") : t("addBank")}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          handleSubmit();
        }}
      >
        <h2 className="text-lg font-semibold text-hq-fg">
          {initial ? t("editBank") : t("addBank")}
        </h2>

        {error ? (
          <div className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.server")}</span>
            <input
              type="number"
              required
              min={1}
              step={1}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.gameServerNumber}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  gameServerNumber: event.target.value,
                }))
              }
            />
          </label>
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.level")}</span>
            <input
              type="number"
              required
              min={1}
              step={1}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.level}
              onChange={(event) =>
                setValues((current) => ({ ...current, level: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.coordX")}</span>
            <input
              type="number"
              required
              step={1}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.coordX}
              onChange={(event) =>
                setValues((current) => ({ ...current, coordX: event.target.value }))
              }
            />
          </label>
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.coordY")}</span>
            <input
              type="number"
              required
              step={1}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.coordY}
              onChange={(event) =>
                setValues((current) => ({ ...current, coordY: event.target.value }))
              }
            />
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("fields.depositPolicy")}</span>
          <AppSelect
            value={values.depositPolicy}
            aria-label={t("fields.depositPolicy")}
            triggerClassName="rounded border border-hq-border bg-hq-canvas"
            options={DEPOSIT_POLICIES.map((policy) => ({
              value: policy,
              label: t(
                `policy${policy.charAt(0).toUpperCase()}${policy.slice(1)}` as
                  | "policyAlliance"
                  | "policyWarzone"
                  | "policyPublic",
              ),
            }))}
            onChange={(value) =>
              setValues((current) => ({
                ...current,
                depositPolicy: value as DepositPolicy,
              }))
            }
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.capturedAt")}</span>
            <input
              type="datetime-local"
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.capturedAt}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  capturedAt: event.target.value,
                }))
              }
            />
          </label>
          <label className="block min-w-0 space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.dropByAt")}</span>
            <input
              type="datetime-local"
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.dropByAt}
              onChange={(event) =>
                setValues((current) => ({ ...current, dropByAt: event.target.value }))
              }
            />
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("fields.notes")}</span>
          <Textarea
            value={values.notes}
            onChange={(event) =>
              setValues((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </label>

        <section className="space-y-3 rounded-lg border border-hq-border bg-hq-canvas/40 px-3 py-3">
          <div>
            <h3 className="text-sm font-semibold text-hq-fg">{tRisk("title")}</h3>
            <p className="mt-1 text-xs text-hq-fg-muted">{tRisk("subtitle")}</p>
          </div>

          {protectionExpiresAt ? (
            <p className="text-xs text-hq-fg-muted">
              {tRisk("protectionExpires", {
                date: formatBrowserLocalDateTime(protectionExpiresAt.toISOString(), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
          ) : (
            <p className="text-xs text-hq-fg-subtle">{tRisk("protectionUnset")}</p>
          )}

          <DepositTermRiskGauges gauges={riskGauges} size="md" />

          <label className="block space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-hq-fg-muted">{tRisk("counterpartyRiskLabel")}</span>
              <span className="font-mono text-xs text-hq-fg">
                {counterpartyRiskScore == null ? "—" : counterpartyRiskScore}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={counterpartyRiskScore ?? 50}
              className="w-full accent-[#8957e5]"
              style={{
                background: `linear-gradient(to right, ${riskIntensityColor(0)} 0%, ${riskIntensityColor((counterpartyRiskScore ?? 50) / 100)} ${counterpartyRiskScore ?? 50}%, var(--hq-border) ${counterpartyRiskScore ?? 50}%)`,
              }}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  counterpartyRiskScore: event.target.value,
                }))
              }
            />
            <p className="text-xs text-hq-fg-subtle">{tRisk("counterpartyRiskHint")}</p>
          </label>

          {showReconfirm && protectionExpiresAt ? (
            <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-hq-fg">
              {tRisk("reconfirmHint", {
                date: formatBrowserLocalDateTime(protectionExpiresAt.toISOString(), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
          ) : null}
        </section>

        <details className="rounded-lg border border-hq-border bg-hq-canvas/40 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-hq-fg">
            {t("advancedSettings")}
          </summary>
          <label className="mt-3 block max-w-xs space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.priorCaptureCount")}</span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-full min-w-0 rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.priorCaptureCount}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  priorCaptureCount: event.target.value,
                }))
              }
            />
          </label>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
              onClick={onClose}
              disabled={saving}
            >
              {t("actions.cancel")}
            </button>
            {initial && onDelete ? (
              <button
                type="button"
                className="rounded border border-hq-danger px-3 py-2 text-sm text-hq-danger"
                onClick={() => void onDelete()}
                disabled={saving}
              >
                {t("actions.delete")}
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={saving}
            title={FORM_SUBMIT_ENTER_KEY_HINT}
          >
            {saving ? t("actions.saving") : t("actions.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
