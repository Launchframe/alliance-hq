"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { MarkerBadge } from "@/components/battle-plan/MarkerBadge";
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
  onSaveMarker: (
    markerNumber: number,
    input: { label: string; colorHex: string },
  ) => Promise<void>;
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
  const [markerDrafts, setMarkerDrafts] = useState<
    Record<number, { label: string; colorHex: string }>
  >(() =>
    Object.fromEntries(
      markers.map((marker) => [
        marker.markerNumber,
        { label: marker.label ?? "", colorHex: marker.colorHex },
      ]),
    ),
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
        <div className="mt-3 space-y-3">
          {markers.map((marker) => {
            const draft = markerDrafts[marker.markerNumber] ?? {
              label: marker.label ?? "",
              colorHex: marker.colorHex,
            };
            return (
              <div key={marker.id} className="space-y-2 rounded border border-hq-border p-3">
                <div className="flex items-center gap-2">
                  <MarkerBadge
                    markerNumber={marker.markerNumber}
                    colorHex={draft.colorHex}
                  />
                  <span className="text-sm font-medium text-hq-fg">
                    {t("event.markerLabel", { marker: marker.markerNumber })}
                  </span>
                </div>
                <label className="block space-y-1 text-sm">
                  <span className="text-hq-fg-muted">{t("markers.color")}</span>
                  <input
                    type="color"
                    className="h-10 w-full cursor-pointer rounded border border-hq-border bg-hq-bg"
                    value={draft.colorHex}
                    disabled={!canWrite || saving}
                    onChange={(event) =>
                      setMarkerDrafts((current) => ({
                        ...current,
                        [marker.markerNumber]: {
                          ...draft,
                          colorHex: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-hq-fg-muted">{t("markers.label")}</span>
                  <input
                    className="w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
                    value={draft.label}
                    disabled={!canWrite || saving}
                    placeholder={t("markers.placeholder")}
                    onChange={(event) =>
                      setMarkerDrafts((current) => ({
                        ...current,
                        [marker.markerNumber]: {
                          ...draft,
                          label: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded border border-hq-border px-3 py-2 text-sm"
                    disabled={saving}
                    onClick={() =>
                      void onSaveMarker(marker.markerNumber, draft)
                    }
                  >
                    {t("actions.save")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
