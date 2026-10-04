"use client";

import { AshedEmbed } from "@/components/AshedEmbed";
import { AllianceRegularEventsSettings } from "@/components/settings/AllianceRegularEventsSettings";
import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";

type Props = {
  allianceTag: string;
  ashedPath: string;
  labelKey: string;
  scoreTargetId: string | null;
  filterEventKey: RegularEventKey;
};

export function RegularEventAshedPage({
  allianceTag,
  ashedPath,
  labelKey,
  scoreTargetId,
  filterEventKey,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <AllianceRegularEventsSettings
        allianceTag={allianceTag}
        filterEventKey={filterEventKey}
        showAnnouncementToggles={false}
      />
      <AshedEmbed
        path={ashedPath}
        labelKey={labelKey}
        scoreTargetId={scoreTargetId}
      />
    </div>
  );
}
