"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type {
  BattlePlanMarkerNumber,
  CapturePolicy,
  SerializedCaptureEvent,
  TerritoryType,
} from "@/lib/battle-plan/types.shared";
import {
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/battle-plan/display.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";

export type CaptureEventFormValues = {
  scheduledAt: string;
  territoryType: TerritoryType;
  markerNumber: BattlePlanMarkerNumber;
  capturePolicy: CapturePolicy | "";
  notes: string;
  status: "scheduled" | "completed" | "cancelled";
};

type Props = {
  open: boolean;
  initial?: SerializedCaptureEvent | null;
  defaultServerDate?: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: CaptureEventFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function defaultScheduledAt(serverDate?: string | null): string {
  if (serverDate) {
    return toDateTimeLocalValue(`${serverDate}T12:00:00.000-02:00`);
  }
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toDateTimeLocalValue(now.toISOString());
}

function valuesFromEvent(event: SerializedCaptureEvent): CaptureEventFormValues {
  return {
    scheduledAt: toDateTimeLocalValue(event.scheduledAt),
    territoryType: event.territoryType,
    markerNumber: event.markerNumber,
    capturePolicy: event.capturePolicy ?? "",
    notes: event.notes ?? "",
    status: event.status === "cancelled" ? "cancelled" : event.status,
  };
}

function buildInitialValues(
  initial: SerializedCaptureEvent | null | undefined,
  defaultServerDate?: string | null,
): CaptureEventFormValues {
  if (initial) {
    return valuesFromEvent(initial);
  }
  return {
    scheduledAt: defaultScheduledAt(defaultServerDate),
    territoryType: "stronghold",
    markerNumber: 1,
    capturePolicy: "",
    notes: "",
    status: "scheduled",
  };
}

type CaptureEventFormProps = {
  initial?: SerializedCaptureEvent | null;
  defaultServerDate?: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: CaptureEventFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function CaptureEventForm({
  initial,
  defaultServerDate,
  saving,
  onClose,
  onSubmit,
  onDelete,
}: CaptureEventFormProps) {
  const t = useTranslations("battlePlan");
  const [values, setValues] = useState<CaptureEventFormValues>(() =>
    buildInitialValues(initial, defaultServerDate),
  );

  return (
    <form
      className="w-full max-w-lg rounded-lg border border-hq-border bg-hq-surface p-5 shadow-xl"
      onSubmit={(event) => {
        preventDefaultFormSubmit(event);
        void onSubmit(values);
      }}
    >
      <h2 className="text-lg font-semibold text-hq-fg">
        {initial ? t("event.editTitle") : t("event.createTitle")}
      </h2>

      <div className="mt-4 space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("event.scheduledAt")}</span>
          <input
            type="datetime-local"
            required
            className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
            value={values.scheduledAt}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                scheduledAt: event.target.value,
              }))
            }
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("event.territoryType")}</span>
          <select
            className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
            value={values.territoryType}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                territoryType: event.target.value as TerritoryType,
              }))
            }
          >
            <option value="stronghold">{t("event.stronghold")}</option>
            <option value="city">{t("event.city")}</option>
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("event.markerNumber")}</span>
          <select
            className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
            value={values.markerNumber}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                markerNumber: Number(event.target.value) as BattlePlanMarkerNumber,
              }))
            }
          >
            {[1, 2, 3, 4, 5].map((marker) => (
              <option key={marker} value={marker}>
                {t("event.markerLabel", { marker })}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("event.capturePolicy")}</span>
          <select
            className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
            value={values.capturePolicy}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                capturePolicy: event.target.value as CapturePolicy | "",
              }))
            }
          >
            <option value="">{t("event.useAllianceDefault")}</option>
            <option value="peace">{t("settings.policyPeace")}</option>
            <option value="war">{t("settings.policyWar")}</option>
          </select>
        </label>

        {initial ? (
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("event.status")}</span>
            <select
              className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
              value={values.status}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  status: event.target.value as CaptureEventFormValues["status"],
                }))
              }
            >
              <option value="scheduled">{t("event.statusScheduled")}</option>
              <option value="completed">{t("event.statusCompleted")}</option>
              <option value="cancelled">{t("event.statusCancelled")}</option>
            </select>
          </label>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("event.notes")}</span>
          <textarea
            className="min-h-20 w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
            value={values.notes}
            onChange={(event) =>
              setValues((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-hq-border px-3 py-2 text-sm"
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
  );
}

export function CaptureEventModal({
  open,
  initial,
  defaultServerDate,
  saving,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  if (!open) return null;

  const formKey = `${initial?.id ?? "new"}:${defaultServerDate ?? "none"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <CaptureEventForm
        key={formKey}
        initial={initial}
        defaultServerDate={defaultServerDate}
        saving={saving}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
      />
    </div>
  );
}

export function captureEventFormToPayload(values: CaptureEventFormValues) {
  return {
    scheduledAt: fromDateTimeLocalValue(values.scheduledAt),
    territoryType: values.territoryType,
    markerNumber: values.markerNumber,
    capturePolicy: values.capturePolicy || null,
    notes: values.notes.trim() || null,
    status: values.status,
  };
}
