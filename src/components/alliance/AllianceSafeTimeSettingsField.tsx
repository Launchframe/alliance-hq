"use client";

import { useTranslations } from "next-intl";

import {
  ALLIANCE_SAFE_TIME_SLOTS,
  allianceSafeTimeSlotI18nKey,
  type AllianceSafeTimeSlot,
} from "@/lib/alliance/alliance-safe-time.shared";

type Props = {
  value: AllianceSafeTimeSlot | null;
  disabled?: boolean;
  saving?: boolean;
  onChange: (slot: AllianceSafeTimeSlot) => void;
};

export function AllianceSafeTimeSettingsField({
  value,
  disabled = false,
  saving = false,
  onChange,
}: Props) {
  const t = useTranslations("allianceSafeTime");

  return (
    <fieldset disabled={disabled || saving} className="space-y-2 border-0 p-0">
      <div>
        <p className="text-sm font-semibold text-hq-fg">{t("title")}</p>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("subtitle")}</p>
        <p className="mt-1 text-xs text-hq-fg-subtle">{t("serverTimeNote")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {ALLIANCE_SAFE_TIME_SLOTS.map((slot) => (
          <label
            key={slot}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted"
          >
            <input
              type="radio"
              name="alliance-safe-time-slot"
              className="accent-[#8957e5]"
              checked={value === slot}
              onChange={() => onChange(slot)}
            />
            {t(allianceSafeTimeSlotI18nKey(slot))}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
