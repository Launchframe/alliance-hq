"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { AppSelect } from "@/components/ui/AppSelect";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/components/banks/datetime-local";
import type { DepositSlipPayload } from "@/lib/banks/api.shared";
import {
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositStatus,
  type DepositTermDays,
  type SerializedDepositSlip,
} from "@/lib/banks/types.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";

type DepositSlipFormValues = {
  depositAt: string;
  termDays: string;
  amount: string;
  status: DepositStatus;
  commanderName: string;
  allianceTag: string;
  outcomeAt: string;
};

function buildInitialValues(
  initial: SerializedDepositSlip | null | undefined,
): DepositSlipFormValues {
  if (!initial) {
    return {
      depositAt: toDatetimeLocalValue(new Date().toISOString()),
      termDays: "1",
      amount: "",
      status: "locked",
      commanderName: "",
      allianceTag: "",
      outcomeAt: "",
    };
  }
  return {
    depositAt: toDatetimeLocalValue(initial.depositAt),
    termDays: String(initial.termDays),
    amount: String(initial.amount),
    status: initial.status,
    commanderName: initial.commanderName,
    allianceTag: initial.depositAllianceTag ?? "",
    outcomeAt: toDatetimeLocalValue(initial.outcomeAt),
  };
}

type Props = {
  open: boolean;
  bankId: string | null;
  initial?: SerializedDepositSlip | null;
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: DepositSlipPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
};

export function DepositSlipEditorModal({
  open,
  bankId,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const t = useTranslations("bankManagement");
  const [values, setValues] = useState<DepositSlipFormValues>(() =>
    buildInitialValues(initial),
  );

  if (!open || !bankId) return null;

  const handleSubmit = () => {
    const depositAtIso = fromDatetimeLocalValue(values.depositAt);
    if (!depositAtIso) return;
    const payload: DepositSlipPayload = {
      bankId,
      depositAt: depositAtIso,
      termDays: Number(values.termDays) as DepositTermDays,
      amount: Number(values.amount),
      // Manual editor has no outcome field yet — preserve OCR-persisted value.
      outcomeAmount: initial?.outcomeAmount ?? null,
      status: values.status,
      commanderName: values.commanderName.trim(),
      depositAllianceTag: values.allianceTag.trim() || null,
      outcomeAt: fromDatetimeLocalValue(values.outcomeAt),
      depositAllianceId: initial?.depositAllianceId ?? null,
      commanderId: initial?.commanderId ?? null,
    };
    void onSubmit(payload);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={initial ? t("editDeposit") : t("addDeposit")}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          handleSubmit();
        }}
      >
        <h2 className="text-lg font-semibold text-hq-fg">
          {initial ? t("editDeposit") : t("addDeposit")}
        </h2>

        {error ? (
          <div className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.depositAt")}</span>
            <input
              type="datetime-local"
              required
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.depositAt}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  depositAt: event.target.value,
                }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.termDays")}</span>
            <AppSelect
              value={values.termDays}
              aria-label={t("fields.termDays")}
              triggerClassName="rounded border border-hq-border bg-hq-canvas"
              options={DEPOSIT_TERMS.map((term) => ({
                value: String(term),
                label: String(term),
              }))}
              onChange={(value) =>
                setValues((current) => ({ ...current, termDays: value }))
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.amount")}</span>
            <input
              type="number"
              required
              min={1}
              step={1}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.amount}
              onChange={(event) =>
                setValues((current) => ({ ...current, amount: event.target.value }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.status")}</span>
            <AppSelect
              value={values.status}
              aria-label={t("fields.status")}
              triggerClassName="rounded border border-hq-border bg-hq-canvas"
              options={DEPOSIT_STATUSES.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              }))}
              onChange={(value) =>
                setValues((current) => ({
                  ...current,
                  status: value as DepositStatus,
                }))
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.commanderName")}</span>
            <input
              type="text"
              required
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.commanderName}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  commanderName: event.target.value,
                }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.allianceTag")}</span>
            <input
              type="text"
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.allianceTag}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  allianceTag: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("fields.outcomeAt")}</span>
          <input
            type="datetime-local"
            className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            value={values.outcomeAt}
            onChange={(event) =>
              setValues((current) => ({ ...current, outcomeAt: event.target.value }))
            }
          />
        </label>

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
