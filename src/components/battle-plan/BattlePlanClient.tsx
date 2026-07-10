"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { BattlePlanCalendar } from "@/components/battle-plan/BattlePlanCalendar";
import { BattlePlanSettingsPanel } from "@/components/battle-plan/BattlePlanSettingsPanel";
import {
  CaptureEventModal,
  captureEventFormToPayload,
  type CaptureEventFormValues,
} from "@/components/battle-plan/CaptureEventModal";
import { UpcomingCapturesList } from "@/components/battle-plan/UpcomingCapturesList";
import { extractHistoricalNotes } from "@/lib/battle-plan/notes-suggestions.shared";
import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import type { BattlePlanDashboardPayload } from "@/lib/battle-plan/types.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

type Props = {
  initial: BattlePlanDashboardPayload;
};

export function BattlePlanClient({ initial }: Props) {
  const t = useTranslations("battlePlan");
  const [dashboard, setDashboard] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<SerializedCaptureEvent | null>(
    null,
  );
  const [selectedServerDate, setSelectedServerDate] = useState<string | null>(null);
  const noteSuggestions = useMemo(
    () => extractHistoricalNotes(dashboard.events),
    [dashboard.events],
  );

  const applyDashboard = useCallback((next: BattlePlanDashboardPayload) => {
    setDashboard(next);
    setError(null);
  }, []);

  const handleMutationError = useCallback(
    async (response: Response) => {
      const data = (await response.json().catch(() => null)) as
        | { error?: string; dashboard?: BattlePlanDashboardPayload }
        | null;
      if (data?.dashboard) {
        applyDashboard(data.dashboard);
      }
      setError(data?.error ?? t("errors.saveFailed"));
    },
    [applyDashboard, t],
  );

  const openCreateModal = (serverDate?: string | null) => {
    setEditingEvent(null);
    setSelectedServerDate(serverDate ?? null);
    setModalOpen(true);
  };

  const openEditModal = (event: SerializedCaptureEvent) => {
    setEditingEvent(event);
    setSelectedServerDate(event.serverCalendarDate);
    setModalOpen(true);
  };

  const saveEvent = async (values: CaptureEventFormValues) => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...captureEventFormToPayload(values),
        planRevision: dashboard.settings.planRevision,
      };
      const response = await fetch(
        editingEvent
          ? `/api/battle-plan/events/${editingEvent.id}`
          : "/api/battle-plan/events",
        {
          method: editingEvent ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as {
        dashboard: BattlePlanDashboardPayload;
      };
      applyDashboard(data.dashboard);
      setModalOpen(false);
      setEditingEvent(null);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!editingEvent) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/battle-plan/events/${editingEvent.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planRevision: dashboard.settings.planRevision,
        }),
      });
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as {
        dashboard: BattlePlanDashboardPayload;
      };
      applyDashboard(data.dashboard);
      setModalOpen(false);
      setEditingEvent(null);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const cancelCaptureEvent = async (event: SerializedCaptureEvent) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/battle-plan/events/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: event.scheduledAt,
          territoryType: event.territoryType,
          markerNumber: event.markerNumber,
          capturePolicy: event.effectiveCapturePolicy,
          notes: event.notes,
          status: "cancelled",
          planRevision: dashboard.settings.planRevision,
        }),
      });
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as {
        dashboard: BattlePlanDashboardPayload;
      };
      applyDashboard(data.dashboard);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (input: { defaultCapturePolicy: "peace" | "war" }) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/battle-plan/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planRevision: dashboard.settings.planRevision,
          defaultCapturePolicy: input.defaultCapturePolicy,
        }),
      });
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as {
        dashboard: BattlePlanDashboardPayload;
      };
      applyDashboard(data.dashboard);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const saveMarker = async (
    markerNumber: number,
    input: { iconPreset: MarkerIconPreset },
  ) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/battle-plan/markers/${markerNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planRevision: dashboard.settings.planRevision,
          iconPreset: input.iconPreset,
        }),
      });
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as {
        dashboard: BattlePlanDashboardPayload;
      };
      applyDashboard(data.dashboard);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        </div>
        {dashboard.canWrite ? (
          <button
            type="button"
            className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white"
            onClick={() => openCreateModal()}
          >
            {t("actions.scheduleCapture")}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-4 py-3 text-sm text-hq-danger">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          <UpcomingCapturesList
            events={dashboard.events}
            markers={dashboard.markers}
            canWrite={dashboard.canWrite}
            onSelect={dashboard.canWrite ? openEditModal : undefined}
          />
          <BattlePlanCalendar
            events={dashboard.events}
            markers={dashboard.markers}
            todayServerDate={dashboard.todayServerDate}
            canWrite={dashboard.canWrite}
            onSelectDate={dashboard.canWrite ? openCreateModal : undefined}
            onSelectEvent={dashboard.canWrite ? openEditModal : undefined}
          />
        </div>

        <BattlePlanSettingsPanel
          key={dashboard.settings.planRevision}
          settings={dashboard.settings}
          markers={dashboard.markers}
          canWrite={dashboard.canWrite}
          saving={saving}
          onSaveSettings={saveSettings}
          onSaveMarker={saveMarker}
        />
      </div>

      <CaptureEventModal
        open={modalOpen}
        initial={editingEvent}
        defaultServerDate={selectedServerDate}
        defaultCapturePolicy={dashboard.settings.defaultCapturePolicy}
        markers={dashboard.markers}
        events={dashboard.events}
        noteSuggestions={noteSuggestions}
        saving={saving}
        onClose={() => {
          setModalOpen(false);
          setEditingEvent(null);
        }}
        onSubmit={saveEvent}
        onDelete={editingEvent ? deleteEvent : undefined}
        onOpenEvent={openEditModal}
        onClearMarkerConflict={cancelCaptureEvent}
      />
    </div>
  );
}
