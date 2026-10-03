"use client";

import { useState } from "react";

import { AllianceTrainLeadTimeSettings } from "@/components/settings/AllianceTrainLeadTimeSettings";
import { AllianceTrainTemplatesSettings } from "@/components/settings/AllianceTrainTemplatesSettings";

export function AllianceTrainScheduleSettings({
  allianceTag,
  initialLeadDays,
}: {
  allianceTag: string;
  initialLeadDays: number;
}) {
  const [leadDays, setLeadDays] = useState(initialLeadDays);
  return (
    <>
      <AllianceTrainLeadTimeSettings
        allianceTag={allianceTag}
        initialLeadDays={initialLeadDays}
        onLeadDaysChange={setLeadDays}
      />
      <AllianceTrainTemplatesSettings leadDays={leadDays} />
    </>
  );
}
