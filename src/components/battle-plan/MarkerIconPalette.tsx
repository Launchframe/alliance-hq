"use client";

import { MarkerIcon } from "@/components/battle-plan/MarkerIcon";
import {
  MARKER_ICON_PRESETS,
  markerPresetI18nKey,
  type MarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";
import { useTranslations } from "next-intl";

type Props = {
  value: MarkerIconPreset | null;
  usedPresets?: ReadonlySet<MarkerIconPreset>;
  disabled?: boolean;
  allowNone?: boolean;
  onChange: (preset: MarkerIconPreset | null) => void;
};

export function MarkerIconPalette({
  value,
  usedPresets,
  disabled,
  allowNone = false,
  onChange,
}: Props) {
  const t = useTranslations("battlePlan");

  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
      {allowNone ? (
        <button
          type="button"
          title={t("event.noMarker")}
          aria-label={t("event.noMarker")}
          aria-pressed={value == null}
          disabled={disabled}
          className={`flex flex-col items-center gap-1 rounded border p-2 text-center transition-colors ${
            value == null
              ? "border-hq-accent bg-hq-accent/10"
              : "border-hq-border bg-hq-bg hover:border-hq-accent/60"
          } disabled:opacity-50`}
          onClick={() => onChange(null)}
        >
          <span className="flex h-7 w-7 items-center justify-center text-xs text-hq-fg-muted">
            —
          </span>
          <span className="line-clamp-2 text-[10px] leading-tight text-hq-fg-muted">
            {t("event.noMarker")}
          </span>
        </button>
      ) : null}
      {MARKER_ICON_PRESETS.map((preset) => {
        const selected = preset === value;
        const inUse = usedPresets?.has(preset) ?? false;
        const label = t(`markers.presets.${markerPresetI18nKey(preset)}`);
        return (
          <button
            key={preset}
            type="button"
            title={label}
            aria-label={inUse ? `${label} (${t("event.markerInUseShort")})` : label}
            aria-pressed={selected}
            disabled={disabled}
            className={`flex flex-col items-center gap-1 rounded border p-2 text-center transition-colors ${
              selected
                ? "border-hq-accent bg-hq-accent/10"
                : inUse
                  ? "border-amber-500/50 bg-amber-500/10 hover:border-amber-500"
                  : "border-hq-border bg-hq-bg hover:border-hq-accent/60"
            } disabled:opacity-50`}
            onClick={() => onChange(preset)}
          >
            <MarkerIcon preset={preset} className="h-7 w-7" />
            <span className="line-clamp-2 text-[10px] leading-tight text-hq-fg-muted">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
