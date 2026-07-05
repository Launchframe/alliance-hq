"use client";

import { useTranslations } from "next-intl";

import type { CommanderIndexHqLinkFilter } from "@/lib/commanders/index.shared";
import type { CommanderIndexPayload } from "@/lib/commanders/index.shared";
import {
  MAIN_SQUAD_LABEL_KEYS,
  MAIN_SQUAD_TYPES,
  type MainSquadType,
} from "@/lib/commanders/main-squad.shared";

type Props = {
  summary: CommanderIndexPayload["summaryBySquad"];
  filterSquad: MainSquadType | "";
  filterHqLink: CommanderIndexHqLinkFilter;
  filterMinThp: string;
  includeUnreported: boolean;
  onFilterSquadChange: (value: MainSquadType | "") => void;
  onFilterHqLinkChange: (value: CommanderIndexHqLinkFilter) => void;
  onFilterMinThpChange: (value: string) => void;
  onIncludeUnreportedChange: (value: boolean) => void;
};

export function RosterSquadSummaryStrip({ summary }: Pick<Props, "summary">) {
  const t = useTranslations("commandersIndex");

  return (
    <div className="flex flex-wrap gap-3">
      {(["aircraft", "tank", "missile"] as const).map((squad) => (
        <div
          key={squad}
          className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm"
        >
          <span className="font-medium text-[#e6edf3]">
            {t(`squad.${MAIN_SQUAD_LABEL_KEYS[squad]}`)}
          </span>
          <span className="text-[#8b949e]">
            {summary[squad].count} ·{" "}
            {t("avgThp", { thp: summary[squad].avgThp.toLocaleString() })}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm">
        <span className="font-medium text-[#8b949e]">{t("unreported")}</span>
        <span className="text-[#8b949e]">
          {summary.unreported.count} ·{" "}
          {t("avgThp", { thp: summary.unreported.avgThp.toLocaleString() })}
        </span>
      </div>
    </div>
  );
}

export function RosterCommanderFilterBar({
  filterSquad,
  filterHqLink,
  filterMinThp,
  includeUnreported,
  onFilterSquadChange,
  onFilterHqLinkChange,
  onFilterMinThpChange,
  onIncludeUnreportedChange,
}: Omit<Props, "summary">) {
  const t = useTranslations("commandersIndex");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
        {t("filterSquad")}
        <select
          value={filterSquad}
          onChange={(event) =>
            onFilterSquadChange(event.target.value as MainSquadType | "")
          }
          className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
        >
          <option value="">{t("filterSquadAll")}</option>
          {MAIN_SQUAD_TYPES.map((squad) => (
            <option key={squad} value={squad}>
              {t(`squad.${MAIN_SQUAD_LABEL_KEYS[squad]}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
        {t("filterHqLink")}
        <div
          className="flex overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] text-sm"
          role="group"
          aria-label={t("filterHqLink")}
        >
          {(
            [
              ["all", "filterHqLinkAll"],
              ["linked", "filterHqLinkLinked"],
              ["not_linked", "filterHqLinkNotLinked"],
            ] as const
          ).map(([value, labelKey], index) => {
            const active = filterHqLink === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterHqLinkChange(value)}
                className={`px-3 py-2 transition-colors ${
                  index > 0 ? "border-l border-[#30363d]" : ""
                } ${
                  active
                    ? "bg-[#1f6feb] text-white"
                    : "text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
        {t("filterMinThp")}
        <input
          value={filterMinThp}
          onChange={(event) => onFilterMinThpChange(event.target.value)}
          inputMode="numeric"
          placeholder="0"
          className="w-32 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-[#8b949e]">
        <input
          type="checkbox"
          checked={includeUnreported}
          onChange={(event) => onIncludeUnreportedChange(event.target.checked)}
        />
        {t("filterIncludeUnreported")}
      </label>
    </div>
  );
}
