"use client";

import { useTranslations } from "next-intl";

import { AllianceSessionSwitcher } from "@/components/alliance/AllianceSessionSwitcher";
import type { SessionAllianceOption } from "@/lib/alliance/types";

type Props = {
  initialCurrentAllianceId?: string | null;
  initialAlliances?: SessionAllianceOption[];
  initialIsPlatformMaintainer?: boolean;
};

export function SidebarAlliancePicker({
  initialCurrentAllianceId = null,
  initialAlliances = [],
  initialIsPlatformMaintainer = false,
}: Props) {
  const t = useTranslations("alliancePicker");

  return (
    <div className="border-b border-[#30363d] px-3 py-3">
      <label className="block min-w-0">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
          {t("label")}
        </span>
        <AllianceSessionSwitcher
          initialCurrentAllianceId={initialCurrentAllianceId}
          initialAlliances={initialAlliances}
          initialIsPlatformMaintainer={initialIsPlatformMaintainer}
        />
      </label>
    </div>
  );
}
