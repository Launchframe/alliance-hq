"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { CommanderIndexRow } from "@/lib/commanders/index.shared";
import {
  MAIN_SQUAD_LABEL_KEYS,
  MAIN_SQUAD_TYPES,
  type MainSquadType,
} from "@/lib/commanders/main-squad.shared";
import {
  buildCommanderTeams,
  type CommanderTeamRow,
} from "@/lib/commanders/team-builder.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { MAX_TAKEDOWN_TEAMS } from "@/lib/vr/constants";

type Props = {
  rows: CommanderIndexRow[];
};

export function RosterTeamBuilderSection({ rows }: Props) {
  const t = useTranslations("commandersIndex");
  const [teamCount, setTeamCount] = useState(1);
  const [teamSquadFilter, setTeamSquadFilter] = useState<MainSquadType | "">("");
  const [teamIncludeUnreported, setTeamIncludeUnreported] = useState(true);
  const [showTeams, setShowTeams] = useState(false);

  const teamRows: CommanderTeamRow[] = rows.map((row) => ({
    ashedMemberId: row.ashedMemberId,
    memberName: row.memberName,
    totalHeroPower: row.totalHeroPower,
    mainSquad: row.mainSquad,
    mainSquadSource: row.mainSquadSource,
    allianceRank: row.allianceRank,
    highestBaseVr: row.highestBaseVr,
  }));

  const teamsResult = showTeams
    ? buildCommanderTeams(teamRows, teamCount, {
        mainSquad: teamSquadFilter || undefined,
        includeUnreported: teamIncludeUnreported,
      })
    : null;

  return (
    <section className="rounded-2xl border border-[#30363d] bg-[#0D0D0D] p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-[#e6edf3]">
        {t("teamBuilder.title")}
      </h2>
      <p className="mt-1 text-sm text-[#8b949e]">{t("teamBuilder.subtitle")}</p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          setShowTeams(true);
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
          {t("teamBuilder.teamCount")}
          <input
            type="number"
            min={1}
            max={MAX_TAKEDOWN_TEAMS}
            value={teamCount}
            onChange={(event) =>
              setTeamCount(
                Math.max(
                  1,
                  Math.min(
                    MAX_TAKEDOWN_TEAMS,
                    Number.parseInt(event.target.value, 10) || 1,
                  ),
                ),
              )
            }
            inputMode="numeric"
            className="w-20 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[#8b949e]">
          {t("teamBuilder.squadFilter")}
          <select
            value={teamSquadFilter}
            onChange={(event) =>
              setTeamSquadFilter(event.target.value as MainSquadType | "")
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

        <label className="flex items-center gap-2 text-sm text-[#8b949e]">
          <input
            type="checkbox"
            checked={teamIncludeUnreported}
            onChange={(event) => setTeamIncludeUnreported(event.target.checked)}
          />
          {t("filterIncludeUnreported")}
        </label>

        <button
          type="submit"
          className="rounded-lg bg-[#1f6feb] px-4 py-2 text-sm font-medium text-white"
        >
          {t("teamBuilder.build")}
        </button>
      </form>

      {teamsResult != null ? (
        <div className="mt-6">
          {teamsResult.ok ? (
            <div className="flex flex-wrap gap-4">
              {teamsResult.teams.map((team) => (
                <div
                  key={team.teamIndex}
                  className="min-w-[220px] flex-1 rounded-xl border border-[#30363d] bg-[#161b22] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#e6edf3]">
                      {t("teamBuilder.teamLabel", { index: team.teamIndex })}
                    </span>
                    <span className="font-mono text-xs text-[#8b949e]">
                      {team.teamTotalHeroPower.toLocaleString()} THP
                    </span>
                  </div>
                  <ul className="space-y-1">
                    <li className="flex items-center gap-2 text-sm">
                      <span className="rounded bg-[#1f6feb33] px-1.5 py-0.5 text-xs font-medium text-[#58a6ff]">
                        {t("teamBuilder.lead")}
                      </span>
                      <span className="truncate text-[#e6edf3]">
                        {team.lead.memberName}
                      </span>
                      <span className="ml-auto font-mono text-xs text-[#8b949e]">
                        {team.lead.totalHeroPower.toLocaleString()}
                      </span>
                    </li>
                    {team.fillers.map((filler) => (
                      <li
                        key={filler.ashedMemberId}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="w-[3.5rem] shrink-0" />
                        <span className="truncate text-[#c9d1d9]">
                          {filler.memberName}
                        </span>
                        <span className="ml-auto font-mono text-xs text-[#8b949e]">
                          {filler.totalHeroPower.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#f85149]">
              {t("teamBuilder.insufficient", {
                needed: teamsResult.needed,
                have: teamsResult.have,
              })}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
