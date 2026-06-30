"use client";

import { AllianceLinkedCommandersBadge } from "@/components/alliance/AllianceLinkedCommandersBadge";
import { alliancePickerOptionPlainLabel } from "@/lib/alliance/alliance-picker-label.shared";
import type { SessionAllianceOption } from "@/lib/alliance/types";

type Props = {
  alliance: SessionAllianceOption;
  activeBadgeLabel: string;
};

export function AlliancePickerOptionLabel({
  alliance,
  activeBadgeLabel,
}: Props) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 wrap-break-word">
        {alliancePickerOptionPlainLabel(alliance)}
      </span>
      {alliance.hasLinkedCommanders ? (
        <AllianceLinkedCommandersBadge label={activeBadgeLabel} />
      ) : null}
    </span>
  );
}
