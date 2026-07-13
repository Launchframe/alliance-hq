"use client";

import { useTranslations } from "next-intl";

import { formatBrowserLocalDateTime } from "@/lib/timezone/format";
import type { MyVrEvent } from "@/lib/vr/my-vr.shared";
import { instituteLevelForBaseVr } from "@/lib/vr/validation";

type Props = {
  seasonKey: string;
  events: MyVrEvent[];
};

function formatDateTime(iso: string): string {
  return formatBrowserLocalDateTime(iso, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isOneInstituteLevelBump(
  seasonKey: string,
  previousBaseVr: number,
  baseVr: number,
): boolean {
  const previousLevel = instituteLevelForBaseVr(seasonKey, previousBaseVr);
  const nextLevel = instituteLevelForBaseVr(seasonKey, baseVr);
  return (
    previousLevel != null &&
    nextLevel != null &&
    nextLevel === previousLevel + 1
  );
}

export function VrProgressTable({ seasonKey, events }: Props) {
  const t = useTranslations("myVr");

  function formatChange(event: MyVrEvent): string {
    if (event.previousBaseVr == null) {
      return t("changeSet");
    }
    const delta = event.baseVr - event.previousBaseVr;
    if (
      delta > 0 &&
      isOneInstituteLevelBump(seasonKey, event.previousBaseVr, event.baseVr)
    ) {
      return t("changeBump", { delta });
    }
    return t("changeFrom", { previous: event.previousBaseVr });
  }

  const rows = [...events].reverse();

  if (rows.length === 0) {
    return (
      <p className="text-sm text-hq-fg-muted">{t("tableEmpty")}</p>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[280px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hq-border text-left text-hq-fg-muted">
            <th className="px-2 py-2 font-medium">{t("tableDate")}</th>
            <th className="px-2 py-2 font-medium">{t("tableInstituteLevel")}</th>
            <th className="px-2 py-2 font-medium">{t("tableLevel")}</th>
            <th className="px-2 py-2 font-medium">{t("tableChange")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => (
            <tr
              key={`${event.createdAt}-${event.baseVr}`}
              className="border-b border-hq-surface-muted text-hq-fg"
            >
              <td className="px-2 py-2 whitespace-nowrap">
                {formatDateTime(event.createdAt)}
              </td>
              <td className="px-2 py-2 font-mono text-hq-fg-muted">
                {event.instituteLevel ?? "—"}
              </td>
              <td className="px-2 py-2 font-mono font-semibold">{event.baseVr}</td>
              <td className="px-2 py-2 text-hq-fg-muted">{formatChange(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
