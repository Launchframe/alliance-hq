"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import { MarkerConflictNotice } from "@/components/battle-plan/MarkerConflictNotice";
import { MarkerIconPalette } from "@/components/battle-plan/MarkerIconPalette";
import { NotesAutocomplete } from "@/components/battle-plan/NotesAutocomplete";
import type {
  CapturePolicy,
  SerializedCaptureEvent,
  TerritoryType,
} from "@/lib/battle-plan/types.shared";
import {
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/battle-plan/display.shared";
import {
  collectUsedMarkerPresets,
  findMarkerPresetConflict,
  findNextAvailableMarkerPreset,
} from "@/lib/battle-plan/marker-conflict.shared";
import {
  markerPresetI18nKey,
  ORDINAL_MARKER_PRESETS,
  type MarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";

export type CaptureEventFormValues = {
  scheduledAt: string;
  territoryType: TerritoryType;
  iconPreset: MarkerIconPreset | null;
  capturePolicy: CapturePolicy;
  notes: string;
  status: "scheduled" | "completed" | "cancelled";
};

type Props = {
  open: boolean;
  initial?: SerializedCaptureEvent | null;
  defaultServerDate?: string | null;
  defaultCapturePolicy: CapturePolicy;
  events: SerializedCaptureEvent[];
  noteSuggestions: readonly string[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: CaptureEventFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  onOpenEvent: (event: SerializedCaptureEvent) => void;
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
    iconPreset: event.iconPreset,
    capturePolicy: event.effectiveCapturePolicy,
    notes: event.notes ?? "",
    status: event.status === "cancelled" ? "cancelled" : event.status,
  };
}

function buildInitialValues(
  initial: SerializedCaptureEvent | null | undefined,
  defaultServerDate: string | null | undefined,
  defaultCapturePolicy: CapturePolicy,
  events: readonly SerializedCaptureEvent[],
): CaptureEventFormValues {
  const markerOptions = { excludeEventId: initial?.id };
  if (initial) {
    const values = valuesFromEvent(initial);
    return {
      ...values,
      iconPreset:
        values.iconPreset ??
        findNextAvailableMarkerPreset(events, markerOptions),
    };
  }
  return {
    scheduledAt: defaultScheduledAt(defaultServerDate),
    territoryType: "stronghold",
    iconPreset: findNextAvailableMarkerPreset(events, markerOptions),
    capturePolicy: defaultCapturePolicy,
    notes: "",
    status: "scheduled",
  };
}

type CaptureEventFormProps = {
  initial?: SerializedCaptureEvent | null;
  defaultServerDate?: string | null;
  defaultCapturePolicy: CapturePolicy;
  events: SerializedCaptureEvent[];
  noteSuggestions: readonly string[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: CaptureEventFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  onOpenEvent: (event: SerializedCaptureEvent) => void;
};

function CaptureEventForm({
  initial,
  defaultServerDate,
  defaultCapturePolicy,
  events,
  noteSuggestions,
  saving,
  onClose,
  onSubmit,
  onDelete,
  onOpenEvent,
}: CaptureEventFormProps) {
  const t = useTranslations("battlePlan");
  const [values, setValues] = useState<CaptureEventFormValues>(() =>
    buildInitialValues(
      initial,
      defaultServerDate,
      defaultCapturePolicy,
      events,
    ),
  );
  const [markerPickerView, setMarkerPickerView] = useState<"quick" | "full">(
    "quick",
  );
  const [awaitingConflictConfirmation, setAwaitingConflictConfirmation] =
    useState(false);
  const usedPresets = useMemo(
    () => collectUsedMarkerPresets(events, { excludeEventId: initial?.id }),
    [events, initial?.id],
  );
  const markerConflict = useMemo(
    () =>
      findMarkerPresetConflict(events, values.iconPreset, {
        excludeEventId: initial?.id,
      }),
    [events, initial?.id, values.iconPreset],
  );
  const presetLabel = (preset: MarkerIconPreset) =>
    t(`markers.presets.${markerPresetI18nKey(preset)}`);
  const selectedMarkerLabel = values.iconPreset
    ? presetLabel(values.iconPreset)
    : t("event.marker");

  const handleSubmit = () => {
    if (markerPickerView === "full") {
      return;
    }
    if (markerConflict && !awaitingConflictConfirmation) {
      setAwaitingConflictConfirmation(true);
      return;
    }
    setAwaitingConflictConfirmation(false);
    void onSubmit(values);
  };

  const returnToEventForm = () => {
    window.setTimeout(() => {
      setMarkerPickerView("quick");
    }, 0);
  };

  return (
    <form
      className="w-full max-w-lg rounded-lg border border-hq-border bg-hq-surface p-5 shadow-xl"
      onSubmit={(event) => {
        preventDefaultFormSubmit(event);
        handleSubmit();
      }}
    >
      <h2 className="text-lg font-semibold text-hq-fg">
        {markerPickerView === "full"
          ? t("event.selectMarkerTitle")
          : initial
            ? t("event.editTitle")
            : t("event.createTitle")}
      </h2>

      {markerPickerView === "full" ? (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            className="text-sm text-hq-accent underline underline-offset-2"
            onClick={returnToEventForm}
          >
            {t("event.backToEvent")}
          </button>
          <MarkerIconPalette
            value={values.iconPreset}
            usedPresets={usedPresets}
            disabled={saving}
            onChange={(iconPreset) => {
              setAwaitingConflictConfirmation(false);
              setValues((current) => ({ ...current, iconPreset }));
            }}
          />
          {markerConflict ? (
            <MarkerConflictNotice
              markerLabel={selectedMarkerLabel}
              conflictingEvent={markerConflict}
              onOpenEvent={onOpenEvent}
            />
          ) : null}
        </div>
      ) : (
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

          <fieldset className="space-y-2 text-sm">
            <legend className="text-hq-fg-muted">{t("event.marker")}</legend>
            <div className="flex flex-wrap gap-2">
              {ORDINAL_MARKER_PRESETS.map((preset) => {
                const selected = values.iconPreset === preset;
                const inUse = usedPresets.has(preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={selected}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                      selected
                        ? "border-hq-accent bg-hq-accent/10"
                        : inUse
                          ? "border-amber-500/50 bg-amber-500/10"
                          : "border-hq-border bg-hq-bg"
                    }`}
                    onClick={() => {
                      setAwaitingConflictConfirmation(false);
                      setValues((current) => ({ ...current, iconPreset: preset }));
                    }}
                  >
                    <MarkerBadge iconPreset={preset} size="sm" />
                    <span className="text-hq-fg">{presetLabel(preset)}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="rounded border border-hq-border bg-hq-bg px-3 py-1.5 text-sm text-hq-fg hover:border-hq-accent"
              onClick={() => setMarkerPickerView("full")}
            >
              {t("event.selectMarker")}
            </button>
            {values.iconPreset &&
            !ORDINAL_MARKER_PRESETS.includes(
              values.iconPreset as (typeof ORDINAL_MARKER_PRESETS)[number],
            ) ? (
              <div className="flex items-center gap-2 rounded border border-hq-border bg-hq-bg px-3 py-2">
                <MarkerBadge iconPreset={values.iconPreset} size="sm" />
                <span className="text-hq-fg">{presetLabel(values.iconPreset)}</span>
              </div>
            ) : null}
            {markerConflict ? (
              <MarkerConflictNotice
                markerLabel={selectedMarkerLabel}
                conflictingEvent={markerConflict}
                onOpenEvent={onOpenEvent}
              />
            ) : null}
          </fieldset>

          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("event.capturePolicy")}</span>
            <select
              className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
              value={values.capturePolicy}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  capturePolicy: event.target.value as CapturePolicy,
                }))
              }
            >
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
            <NotesAutocomplete
              value={values.notes}
              suggestions={noteSuggestions}
              placeholder={t("event.notesPlaceholder")}
              onChange={(notes) => setValues((current) => ({ ...current, notes }))}
            />
          </label>
        </div>
      )}

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
          {initial && onDelete && markerPickerView === "quick" ? (
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
        {markerPickerView === "quick" ? (
          awaitingConflictConfirmation && markerConflict ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-hq-border px-3 py-2 text-sm"
                disabled={saving}
                onClick={() => setAwaitingConflictConfirmation(false)}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="submit"
                className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={saving}
                title={FORM_SUBMIT_ENTER_KEY_HINT}
              >
                {saving ? t("actions.saving") : t("event.confirmConflictSave")}
              </button>
            </div>
          ) : (
            <button
              type="submit"
              className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={saving || values.iconPreset == null}
              title={FORM_SUBMIT_ENTER_KEY_HINT}
            >
              {saving ? t("actions.saving") : t("actions.save")}
            </button>
          )
        ) : (
          <button
            type="button"
            className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={returnToEventForm}
          >
            {t("event.doneSelectingMarker")}
          </button>
        )}
      </div>
    </form>
  );
}

export function CaptureEventModal({
  open,
  initial,
  defaultServerDate,
  defaultCapturePolicy,
  events,
  noteSuggestions,
  saving,
  onClose,
  onSubmit,
  onDelete,
  onOpenEvent,
}: Props) {
  if (!open) return null;

  const formKey = `${initial?.id ?? "new"}:${defaultServerDate ?? "none"}:${defaultCapturePolicy}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <CaptureEventForm
        key={formKey}
        initial={initial}
        defaultServerDate={defaultServerDate}
        defaultCapturePolicy={defaultCapturePolicy}
        events={events}
        noteSuggestions={noteSuggestions}
        saving={saving}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
        onOpenEvent={onOpenEvent}
      />
    </div>
  );
}

export function captureEventFormToPayload(values: CaptureEventFormValues) {
  return {
    scheduledAt: fromDateTimeLocalValue(values.scheduledAt),
    territoryType: values.territoryType,
    iconPreset: values.iconPreset,
    capturePolicy: values.capturePolicy,
    notes: values.notes.trim() || null,
    status: values.status,
  };
}
