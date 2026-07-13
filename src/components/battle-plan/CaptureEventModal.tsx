"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
import { MarkerConflictNotice } from "@/components/battle-plan/MarkerConflictNotice";
import { MarkerIconPalette } from "@/components/battle-plan/MarkerIconPalette";
import { NotesAutocomplete } from "@/components/battle-plan/NotesAutocomplete";
import { AppSelect } from "@/components/ui/AppSelect";
import { SegmentedCodeInput } from "@/components/ui/SegmentedCodeInput";
import type {
  CapturePolicy,
  SerializedCaptureEvent,
  TerritoryType,
} from "@/lib/battle-plan/types.shared";
import {
  isoToRelativeDurationDigits,
  isValidRelativeDurationDigits,
  relativeDurationDigitsToIso,
} from "@/lib/battle-plan/relative-duration.shared";
import {
  buildDefaultCaptureDateTime,
  getZonedDateTimeParts,
  resolveBattlePlanIana,
  zonedDateTimeToIso,
  type BattlePlanTimeDisplay,
} from "@/lib/battle-plan/time-display.shared";
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

export type CaptureScheduleMode = "absolute" | "relative";

export type CaptureEventFormValues = {
  scheduleMode: CaptureScheduleMode;
  scheduledDate: string;
  scheduledTime: string;
  /** Digits-only DDHHMM for "from now" mode. */
  relativeDuration: string;
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
  timeDisplay: BattlePlanTimeDisplay;
  events: SerializedCaptureEvent[];
  noteSuggestions: readonly string[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: CaptureEventFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  onOpenEvent: (event: SerializedCaptureEvent) => void;
};

function valuesFromEvent(
  event: SerializedCaptureEvent,
  timeDisplay: BattlePlanTimeDisplay,
): CaptureEventFormValues {
  const parts = getZonedDateTimeParts(
    event.scheduledAt,
    resolveBattlePlanIana(timeDisplay),
  );
  return {
    scheduleMode: "absolute",
    scheduledDate: parts.date,
    scheduledTime: parts.time,
    relativeDuration: isoToRelativeDurationDigits(event.scheduledAt),
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
  timeDisplay: BattlePlanTimeDisplay,
  events: readonly SerializedCaptureEvent[],
): CaptureEventFormValues {
  const markerOptions = { excludeEventId: initial?.id };
  if (initial) {
    const values = valuesFromEvent(initial, timeDisplay);
    return {
      ...values,
      iconPreset:
        values.iconPreset ??
        findNextAvailableMarkerPreset(events, markerOptions),
    };
  }
  const defaults = buildDefaultCaptureDateTime(timeDisplay, defaultServerDate);
  return {
    scheduleMode: "absolute",
    scheduledDate: defaults.date,
    scheduledTime: defaults.time,
    relativeDuration: "",
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
  timeDisplay: BattlePlanTimeDisplay;
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
  timeDisplay,
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
      timeDisplay,
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
  const scheduleReady =
    values.scheduleMode === "absolute" ||
    isValidRelativeDurationDigits(values.relativeDuration);

  const switchScheduleMode = (mode: CaptureScheduleMode) => {
    setAwaitingConflictConfirmation(false);
    setValues((current) => {
      if (mode === current.scheduleMode) {
        return current;
      }
      if (mode === "relative") {
        const iso = zonedDateTimeToIso(
          current.scheduledDate,
          current.scheduledTime,
          resolveBattlePlanIana(timeDisplay),
        );
        return {
          ...current,
          scheduleMode: "relative",
          relativeDuration: isoToRelativeDurationDigits(iso),
        };
      }
      const parts = getZonedDateTimeParts(
        relativeDurationDigitsToIso(current.relativeDuration),
        resolveBattlePlanIana(timeDisplay),
      );
      return {
        ...current,
        scheduleMode: "absolute",
        scheduledDate: parts.date,
        scheduledTime: parts.time,
      };
    });
  };

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
              timeDisplay={timeDisplay}
              onOpenEvent={onOpenEvent}
            />
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <div
              className="inline-flex rounded-lg border border-hq-border bg-hq-canvas p-0.5"
              role="tablist"
              aria-label={t("event.scheduleModeLabel")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={values.scheduleMode === "absolute"}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  values.scheduleMode === "absolute"
                    ? "bg-hq-surface text-hq-fg"
                    : "text-hq-fg-muted hover:text-hq-fg"
                }`}
                onClick={() => switchScheduleMode("absolute")}
              >
                {t("event.scheduleModeAbsolute")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={values.scheduleMode === "relative"}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  values.scheduleMode === "relative"
                    ? "bg-hq-surface text-hq-fg"
                    : "text-hq-fg-muted hover:text-hq-fg"
                }`}
                onClick={() => switchScheduleMode("relative")}
              >
                {t("event.scheduleModeRelative")}
              </button>
            </div>

            {values.scheduleMode === "absolute" ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="text-hq-fg-muted">
                      {t("event.scheduledDate")}
                    </span>
                    <input
                      type="date"
                      required
                      className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
                      value={values.scheduledDate}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          scheduledDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="text-hq-fg-muted">
                      {t("event.scheduledTime")}
                    </span>
                    <input
                      type="time"
                      required
                      className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
                      value={values.scheduledTime}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          scheduledTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <p className="text-xs text-hq-fg-muted">
                  {timeDisplay === "server"
                    ? t("timeDisplay.editingServer")
                    : t("timeDisplay.editingLocal")}
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <span className="block text-sm text-hq-fg-muted">
                  {t("event.relativeDuration")}
                </span>
                <SegmentedCodeInput
                  format="duration-dhhmm"
                  value={values.relativeDuration}
                  aria-label={t("event.relativeDuration")}
                  groupLabels={[
                    t("event.relativeDays"),
                    t("event.relativeHours"),
                    t("event.relativeMinutes"),
                  ]}
                  onChange={(relativeDuration) =>
                    setValues((current) => ({
                      ...current,
                      relativeDuration,
                    }))
                  }
                  onSubmit={handleSubmit}
                />
                <p className="text-xs text-hq-fg-muted">
                  {t("event.relativeDurationHint")}
                </p>
              </div>
            )}
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("event.territoryType")}</span>
            <AppSelect
              value={values.territoryType}
              aria-label={t("event.territoryType")}
              triggerClassName="rounded border border-hq-border bg-hq-bg"
              options={[
                { value: "stronghold", label: t("event.stronghold") },
                { value: "city", label: t("event.city") },
              ]}
              onChange={(territoryType) =>
                setValues((current) => ({
                  ...current,
                  territoryType: territoryType as TerritoryType,
                }))
              }
            />
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
                timeDisplay={timeDisplay}
                onOpenEvent={onOpenEvent}
              />
            ) : null}
          </fieldset>

          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("event.capturePolicy")}</span>
            <AppSelect
              value={values.capturePolicy}
              aria-label={t("event.capturePolicy")}
              triggerClassName="rounded border border-hq-border bg-hq-bg"
              options={[
                { value: "peace", label: t("settings.policyPeace") },
                { value: "war", label: t("settings.policyWar") },
              ]}
              onChange={(capturePolicy) =>
                setValues((current) => ({
                  ...current,
                  capturePolicy: capturePolicy as CapturePolicy,
                }))
              }
            />
          </label>

          {initial ? (
            <label className="block space-y-1 text-sm">
              <span className="text-hq-fg-muted">{t("event.status")}</span>
              <AppSelect
                value={values.status}
                aria-label={t("event.status")}
                triggerClassName="rounded border border-hq-border bg-hq-bg"
                options={[
                  { value: "scheduled", label: t("event.statusScheduled") },
                  { value: "completed", label: t("event.statusCompleted") },
                  { value: "cancelled", label: t("event.statusCancelled") },
                ]}
                onChange={(status) =>
                  setValues((current) => ({
                    ...current,
                    status: status as CaptureEventFormValues["status"],
                  }))
                }
              />
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
                disabled={saving || values.iconPreset == null || !scheduleReady}
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
  timeDisplay,
  events,
  noteSuggestions,
  saving,
  onClose,
  onSubmit,
  onDelete,
  onOpenEvent,
}: Props) {
  if (!open) return null;

  const formKey = `${initial?.id ?? "new"}:${defaultServerDate ?? "none"}:${defaultCapturePolicy}:${timeDisplay}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <CaptureEventForm
        key={formKey}
        initial={initial}
        defaultServerDate={defaultServerDate}
        defaultCapturePolicy={defaultCapturePolicy}
        timeDisplay={timeDisplay}
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

export function captureEventFormToPayload(
  values: CaptureEventFormValues,
  timeDisplay: BattlePlanTimeDisplay,
) {
  const scheduledAt =
    values.scheduleMode === "relative"
      ? relativeDurationDigitsToIso(values.relativeDuration)
      : zonedDateTimeToIso(
          values.scheduledDate,
          values.scheduledTime,
          resolveBattlePlanIana(timeDisplay),
        );
  return {
    scheduledAt,
    territoryType: values.territoryType,
    iconPreset: values.iconPreset,
    capturePolicy: values.capturePolicy,
    notes: values.notes.trim() || null,
    status: values.status,
  };
}
