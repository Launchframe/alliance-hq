"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { MarkerAssignmentField } from "@/components/banks/MarkerAssignmentField";
import { Dialog } from "@/components/ui/dialog";
import { findMarkerPresetConflict } from "@/lib/battle-plan/marker-conflict.shared";
import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import type { BattlePlanTimeDisplay } from "@/lib/battle-plan/time-display.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";

type Props = {
  open: boolean;
  bankLabel: string;
  scheduledAt: string;
  iconPreset: MarkerIconPreset | null;
  events: readonly SerializedCaptureEvent[];
  timeDisplay: BattlePlanTimeDisplay;
  saving: boolean;
  onScheduledAtChange: (value: string) => void;
  onIconPresetChange: (preset: MarkerIconPreset | null) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function ScheduleDropMarkerModal({
  open,
  bankLabel,
  scheduledAt,
  iconPreset,
  events,
  timeDisplay,
  saving,
  onScheduledAtChange,
  onIconPresetChange,
  onClose,
  onConfirm,
}: Props) {
  const t = useTranslations("bankManagement.scheduleDropMarker");
  const [awaitingConflictConfirmation, setAwaitingConflictConfirmation] =
    useState(false);

  const markerConflict = useMemo(
    () => findMarkerPresetConflict(events, iconPreset),
    [events, iconPreset],
  );

  if (!open) {
    return null;
  }

  const handleConfirm = () => {
    if (!iconPreset) {
      return;
    }
    if (markerConflict && !awaitingConflictConfirmation) {
      setAwaitingConflictConfirmation(true);
      return;
    }
    setAwaitingConflictConfirmation(false);
    onConfirm();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setAwaitingConflictConfirmation(false);
          onClose();
        }
      }}
      title={t("title")}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          handleConfirm();
        }}
      >
        <p className="text-sm text-hq-fg-muted">{bankLabel}</p>

        <label className="block space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("scheduledAt")}</span>
          <input
            type="datetime-local"
            className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
            value={scheduledAt}
            disabled={saving}
            onChange={(event) => {
              setAwaitingConflictConfirmation(false);
              onScheduledAtChange(event.target.value);
            }}
          />
        </label>

        <MarkerAssignmentField
          label={t("markerLabel")}
          value={iconPreset}
          events={events}
          timeDisplay={timeDisplay}
          disabled={saving}
          onChange={(preset) => {
            setAwaitingConflictConfirmation(false);
            onIconPresetChange(preset);
          }}
        />

        {awaitingConflictConfirmation && markerConflict ? (
          <p className="text-sm text-amber-200">{t("confirmConflict")}</p>
        ) : null}

        {!iconPreset ? (
          <p className="text-xs text-hq-danger">{t("markerRequired")}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
            disabled={saving}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={saving || !iconPreset}
            title={FORM_SUBMIT_ENTER_KEY_HINT}
          >
            {saving
              ? t("scheduling")
              : awaitingConflictConfirmation
                ? t("confirmConflictAction")
                : t("confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
