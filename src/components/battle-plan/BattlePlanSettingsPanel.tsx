"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import type {
  CapturePolicy,
  SerializedBattlePlanSettings,
} from "@/lib/battle-plan/types.shared";

type Props = {
  settings: SerializedBattlePlanSettings;
  canWrite: boolean;
  saving: boolean;
  onSaveSettings: (input: {
    defaultCapturePolicy: CapturePolicy;
  }) => Promise<void>;
};

export function BattlePlanSettingsPanel({
  settings,
  canWrite,
  saving,
  onSaveSettings,
}: Props) {
  const t = useTranslations("battlePlan");
  const [defaultCapturePolicy, setDefaultCapturePolicy] = useState(
    settings.defaultCapturePolicy,
  );

  return (
    <div className="space-y-4 rounded-lg border border-hq-border bg-hq-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">{t("settings.title")}</h2>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("settings.subtitle")}</p>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-hq-fg-muted">{t("settings.defaultPolicy")}</span>
        <AppSelect
          value={defaultCapturePolicy}
          aria-label={t("settings.defaultPolicy")}
          disabled={!canWrite || saving}
          triggerClassName="rounded border border-hq-border bg-hq-bg"
          options={[
            { value: "peace", label: t("settings.policyPeace") },
            { value: "war", label: t("settings.policyWar") },
          ]}
          onChange={(value) =>
            setDefaultCapturePolicy(value as CapturePolicy)
          }
        />
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
    </div>
  );
}
