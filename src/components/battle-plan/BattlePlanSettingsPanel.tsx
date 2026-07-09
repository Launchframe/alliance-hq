"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type {
  CapturePolicy,
  SerializedBattlePlanMarker,
  SerializedBattlePlanSettings,
} from "@/lib/battle-plan/types.shared";

type Props = {
  settings: SerializedBattlePlanSettings;
  markers: SerializedBattlePlanMarker[];
  canWrite: boolean;
  saving: boolean;
  onSaveSettings: (input: {
    defaultCapturePolicy: CapturePolicy;
  }) => Promise<void>;
  onSaveMarker: (markerNumber: number, label: string) => Promise<void>;
};

export function BattlePlanSettingsPanel({
  settings,
  markers,
  canWrite,
  saving,
  onSaveSettings,
  onSaveMarker,
}: Props) {
  const t = useTranslations("battlePlan");
  const [defaultCapturePolicy, setDefaultCapturePolicy] = useState(
    settings.defaultCapturePolicy,
  );
  const [markerLabels, setMarkerLabels] = useState<Record<number, string>>(() =>
    Object.fromEntries(markers.map((marker) => [marker.markerNumber, marker.label ?? ""])),
  );

  return (
    <div className="space-y-4 rounded-lg border border-hq-border bg-hq-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">{t("settings.title")}</h2>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("settings.subtitle")}</p>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-hq-fg-muted">{t("settings.defaultPolicy")}</span>
        <select
          className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
          value={defaultCapturePolicy}
          disabled={!canWrite || saving}
          onChange={(event) =>
            setDefaultCapturePolicy(event.target.value as CapturePolicy)
          }
        >
          <option value="peace">{t("settings.policyPeace")}</option>
          <option value="war">{t("settings.policyWar")}</option>
        </select>
      </label>

      {canWrite ? (
        <button
          type="button"
          className="rounded border border-hq-success bg-hq-success px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void onSaveSettings({ defaultCapturePolicy })}
        >
          {saving ? t("actions.saving") : t("settings.savePolicy")}
        </button>
      ) : null}

      <div className="border-t border-hq-border pt-4">
        <h3 className="text-sm font-semibold text-hq-fg">{t("markers.title")}</h3>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("markers.subtitle")}</p>
        <div className="mt-3 space-y-2">
          {markers.map((marker) => (
            <label key={marker.id} className="block space-y-1 text-sm">
              <span className="text-hq-fg-muted">
                {t("event.markerLabel", { marker: marker.markerNumber })}
              </span>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-hq-border bg-hq-bg px-3 py-2"
                  value={markerLabels[marker.markerNumber] ?? ""}
                  disabled={!canWrite || saving}
                  placeholder={t("markers.placeholder")}
                  onChange={(event) =>
                    setMarkerLabels((current) => ({
                      ...current,
                      [marker.markerNumber]: event.target.value,
                    }))
                  }
                />
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded border border-hq-border px-3 py-2 text-sm"
                    disabled={saving}
                    onClick={() =>
                      void onSaveMarker(
                        marker.markerNumber,
                        markerLabels[marker.markerNumber] ?? "",
                      )
                    }
                  >
                    {t("actions.save")}
                  </button>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
