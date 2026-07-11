"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { AppSelect } from "@/components/ui/AppSelect";
import { Textarea } from "@/components/ui/textarea";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/components/banks/datetime-local";
import type { BankPayload } from "@/lib/banks/api.shared";
import { DEPOSIT_POLICIES, type SerializedBank } from "@/lib/banks/types.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";

type BankFormValues = {
  gameServerNumber: string;
  coordX: string;
  coordY: string;
  level: string;
  depositPolicy: string;
  priorCaptureCount: string;
  capturedAt: string;
  dropByAt: string;
  notes: string;
};

function buildInitialValues(initial: SerializedBank | null | undefined): BankFormValues {
  if (!initial) {
    return {
      gameServerNumber: "",
      coordX: "",
      coordY: "",
      level: "",
      depositPolicy: "",
      priorCaptureCount: "0",
      capturedAt: "",
      dropByAt: "",
      notes: "",
    };
  }
  return {
    gameServerNumber: String(initial.gameServerNumber),
    coordX: String(initial.coordX),
    coordY: String(initial.coordY),
    level: String(initial.level),
    depositPolicy: initial.depositPolicy ?? "",
    priorCaptureCount: String(initial.priorCaptureCount ?? 0),
    capturedAt: toDatetimeLocalValue(initial.capturedAt),
    dropByAt: toDatetimeLocalValue(initial.dropByAt),
    notes: initial.notes ?? "",
  };
}

type Props = {
  open: boolean;
  initial?: SerializedBank | null;
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: BankPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
};

export function BankEditorModal({
  open,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const t = useTranslations("bankManagement");
  const [values, setValues] = useState<BankFormValues>(() =>
    buildInitialValues(initial),
  );

  if (!open) return null;

  const handleSubmit = () => {
    const payload: BankPayload = {
      gameServerNumber: Number(values.gameServerNumber),
      coordX: Number(values.coordX),
      coordY: Number(values.coordY),
      level: Number(values.level),
      depositPolicy: (values.depositPolicy as BankPayload["depositPolicy"]) || null,
      priorCaptureCount: values.priorCaptureCount
        ? Number(values.priorCaptureCount)
        : 0,
      capturedAt: fromDatetimeLocalValue(values.capturedAt),
      dropByAt: fromDatetimeLocalValue(values.dropByAt),
      notes: values.notes.trim() || null,
      currentDepositCount: initial?.currentDepositCount ?? null,
      currentDepositValue: initial?.currentDepositValue ?? null,
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.server")}</span>
            <input
              type="number"
              required
              min={1}
              step={1}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.gameServerNumber}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  gameServerNumber: event.target.value,
                }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.coordX")}</span>
            <input
              type="number"
              required
              step={1}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.coordX}
              onChange={(event) =>
                setValues((current) => ({ ...current, coordX: event.target.value }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.coordY")}</span>
            <input
              type="number"
              required
              step={1}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.coordY}
              onChange={(event) =>
                setValues((current) => ({ ...current, coordY: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.level")}</span>
            <input
              type="number"
              required
              min={1}
              step={1}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.level}
              onChange={(event) =>
                setValues((current) => ({ ...current, level: event.target.value }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.priorCaptureCount")}</span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.priorCaptureCount}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  priorCaptureCount: event.target.value,
                }))
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
            options={[
              { value: "", label: t("policyUnset") },
              ...DEPOSIT_POLICIES.map((policy) => ({
                value: policy,
                label: t(
                  `policy${policy.charAt(0).toUpperCase()}${policy.slice(1)}` as
                    | "policyAlliance"
                    | "policyWarzone"
                    | "policyPublic",
                ),
              })),
            ]}
            onChange={(value) =>
              setValues((current) => ({ ...current, depositPolicy: value }))
            }
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.capturedAt")}</span>
            <input
              type="datetime-local"
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={values.capturedAt}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  capturedAt: event.target.value,
                }))
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.dropByAt")}</span>
            <input
              type="datetime-local"
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
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
