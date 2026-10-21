"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  TEAM_BUILDER_RANK_KEYS,
  buildTeamDraft,
  countEngineerRanks,
  formatPairingExport,
  suggestEngineerRatio,
  teamBuilderRankKey,
  type TeamBuilderDraft,
  type TeamBuilderPerson,
  type TeamBuilderRankKey,
} from "@/lib/professions/team-builder.shared";

type RosterMember = TeamBuilderPerson & {
  profession: "Engineer" | "War Leader" | null;
};

type ProfessionChoice = "Engineer" | "War Leader";

function rankLabel(
  rank: number | null,
  unknown: string,
): string {
  const key = teamBuilderRankKey(rank);
  return key === "unknown" ? unknown : `R${key}`;
}

function mixParts(
  engineers: TeamBuilderPerson[],
  targets: Record<TeamBuilderRankKey, number>,
  unknown: string,
): string {
  const actual = countEngineerRanks(engineers);
  return TEAM_BUILDER_RANK_KEYS.filter(
    (key) => targets[key] > 0 || actual[key] > 0,
  )
    .map((key) => {
      const label = key === "unknown" ? unknown : `R${key}`;
      return `${label} ${actual[key]}/${targets[key]}`;
    })
    .join(" · ");
}

export function TeamBuilderPanel({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations("professions.builder");
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ProfessionChoice>>({});
  const [targetOverride, setTargetOverride] = useState<number | null>(null);
  const [draft, setDraft] = useState<TeamBuilderDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ assigned: number; moved: number } | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>("load");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/professions/officer/team-builder");
        const json = (await res.json()) as {
          error?: string;
          members?: RosterMember[];
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error ?? t("loadFailed"));
          return;
        }
        setMembers(json.members ?? []);
      } catch {
        if (!cancelled) setLoadError(t("loadFailed"));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  function professionOf(member: RosterMember): ProfessionChoice | null {
    if (member.profession) return member.profession;
    return overrides[member.commanderId] ?? null;
  }

  const missing = (members ?? []).filter((member) => member.profession === null);
  const unresolved = missing.filter((member) => !overrides[member.commanderId]);
  const warLeaders = (members ?? []).filter(
    (member) => professionOf(member) === "War Leader",
  );
  const engineers = (members ?? []).filter(
    (member) => professionOf(member) === "Engineer",
  );
  const ratio = suggestEngineerRatio(warLeaders.length, engineers.length);
  const suggestedBase = ratio.ok ? ratio.base : 0;
  const target = targetOverride ?? suggestedBase;

  const exportText = useMemo(() => {
    if (!draft) return "";
    return formatPairingExport(
      draft.teams.map((team) => ({
        wlName: team.wl.name,
        engineerNames: team.engineers.map((engineer) => engineer.name),
      })),
    );
  }, [draft]);

  function setProfession(commanderId: string, profession: ProfessionChoice) {
    setOverrides((current) => ({ ...current, [commanderId]: profession }));
    setDraft(null);
    setSaved(null);
  }

  function setRemainingEngineers() {
    setOverrides((current) => {
      const next = { ...current };
      for (const member of missing) {
        if (!next[member.commanderId]) next[member.commanderId] = "Engineer";
      }
      return next;
    });
    setDraft(null);
    setSaved(null);
  }

  function generate() {
    setSaveError(null);
    setSaved(null);
    setCopied(false);
    if (unresolved.length > 0 || !ratio.ok) return;
    setDraft(
      buildTeamDraft({
        warLeaders,
        engineers,
        target,
      }),
    );
  }

  function moveEngineer(commanderId: string, destination: string) {
    setDraft((current) => {
      if (!current) return current;
      const engineer = [...current.teams.flatMap((team) => team.engineers), ...current.unplaced]
        .find((person) => person.commanderId === commanderId);
      if (!engineer) return current;
      const teams = current.teams.map((team) => ({
        ...team,
        engineers: team.engineers.filter((person) => person.commanderId !== commanderId),
      }));
      const unplaced = current.unplaced.filter(
        (person) => person.commanderId !== commanderId,
      );
      if (destination === "unplaced") {
        unplaced.push(engineer);
      } else {
        const team = teams.find((row) => row.wl.commanderId === destination);
        team?.engineers.push(engineer);
      }
      return { teams, unplaced };
    });
    setSaved(null);
    setCopied(false);
  }

  async function copyList() {
    if (!exportText) return;
    await navigator.clipboard.writeText(exportText);
    setCopied(true);
  }

  function downloadList() {
    if (!exportText) return;
    const blob = new Blob([exportText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pairing-list.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setSaveError(null);
    try {
      const professionFills = missing.flatMap((member) => {
        const profession = overrides[member.commanderId];
        return profession ? [{ commanderId: member.commanderId, profession }] : [];
      });
      const assignments = [
        ...draft.teams.flatMap((team) =>
          team.engineers.map((engineer) => ({
            engCommanderId: engineer.commanderId,
            wlCommanderId: team.wl.commanderId,
          })),
        ),
        ...draft.unplaced.map((engineer) => ({
          engCommanderId: engineer.commanderId,
          wlCommanderId: null,
        })),
      ];
      const res = await fetch("/api/professions/officer/team-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professionFills, assignments }),
      });
      const json = (await res.json()) as {
        error?: string;
        assigned?: number;
        moved?: number;
      };
      if (!res.ok) {
        setSaveError(json.error ?? t("saveFailed"));
        return;
      }
      setSaved({ assigned: json.assigned ?? 0, moved: json.moved ?? 0 });
      onSaved();
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  const canGenerate = unresolved.length === 0 && ratio.ok && busy === null;

  return (
    <section className="space-y-4" data-testid="profession-team-builder">
      <div>
        <h2 className="text-sm font-semibold text-hq-fg">{t("title")}</h2>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("desc")}</p>
      </div>

      {loadError ? <p className="text-xs text-hq-danger">{loadError}</p> : null}

      {missing.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-hq-fg-muted">{t("missingTitle")}</h3>
            <Button type="button" size="sm" variant="ghost" onClick={setRemainingEngineers}>
              {t("setRemainingEngineer")}
            </Button>
          </div>
          <ul className="divide-y divide-hq-border rounded-lg border border-hq-border">
            {missing.map((member) => {
              const choice = overrides[member.commanderId] ?? null;
              return (
                <li
                  key={member.commanderId}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="text-sm text-hq-fg">
                    {member.name}{" "}
                    <span className="text-xs text-hq-fg-muted">
                      {rankLabel(member.rank, t("unknownRank"))}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={choice === "Engineer" ? "default" : "ghost"}
                      onClick={() => setProfession(member.commanderId, "Engineer")}
                    >
                      {t("setEngineer")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={choice === "War Leader" ? "default" : "ghost"}
                      onClick={() => setProfession(member.commanderId, "War Leader")}
                    >
                      {t("setWarLeader")}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {unresolved.length > 0 ? (
        <p className="text-xs text-hq-warning">{t("needProfessions")}</p>
      ) : null}
      {!ratio.ok ? (
        <p className="text-xs text-hq-warning">{t("needWarLeader")}</p>
      ) : (
        <p className="text-sm text-hq-fg">
          {t("ratio", {
            engineers: ratio.engineers,
            warLeaders: ratio.warLeaders,
            base: ratio.base,
          })}
          {ratio.extra > 0 ? ` ${t("ratioRemainder", { extra: ratio.extra })}` : null}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-hq-fg-muted">
          {t("targetLabel")}
          <input
            type="number"
            min={0}
            max={99}
            value={target}
            onChange={(event) => {
              const next = Number(event.target.value);
              setTargetOverride(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
              setDraft(null);
            }}
            className="block w-24 rounded-lg border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg"
          />
        </label>
        <Button type="button" size="sm" disabled={!canGenerate} onClick={generate}>
          {t("generate")}
        </Button>
      </div>

      {draft ? (
        <div className="space-y-3">
          <ul className="space-y-3">
            {draft.teams.map((team) => (
              <li key={team.wl.commanderId} className="rounded-lg border border-hq-border p-3">
                <p className="text-sm font-medium text-hq-fg">{team.wl.name}</p>
                <p className="mt-1 text-xs text-hq-fg-muted">
                  {t("rankMix")}{" "}
                  {mixParts(team.engineers, team.rankTargets, t("unknownRank")) || "—"}
                </p>
                <ul className="mt-2 space-y-1">
                  {team.engineers.map((engineer) => (
                    <EngineerRow
                      key={engineer.commanderId}
                      engineer={engineer}
                      destination={team.wl.commanderId}
                      teams={draft.teams}
                      unknownRank={t("unknownRank")}
                      moveLabel={t("reassignSelect", { name: engineer.name })}
                      unplacedLabel={t("unplaced")}
                      onMove={moveEngineer}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {draft.unplaced.length > 0 ? (
            <div className="rounded-lg border border-hq-border p-3">
              <p className="text-sm font-medium text-hq-fg">{t("unplaced")}</p>
              <ul className="mt-2 space-y-1">
                {draft.unplaced.map((engineer) => (
                  <EngineerRow
                    key={engineer.commanderId}
                    engineer={engineer}
                    destination="unplaced"
                    teams={draft.teams}
                    unknownRank={t("unknownRank")}
                    moveLabel={t("reassignSelect", { name: engineer.name })}
                    unplacedLabel={t("unplaced")}
                    onMove={moveEngineer}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={!exportText} onClick={() => void copyList()}>
              {copied ? t("copied") : t("export")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={!exportText} onClick={downloadList}>
              {t("download")}
            </Button>
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void save()}>
              {busy === "save" ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      ) : null}

      {saveError ? <p className="text-xs text-hq-danger">{saveError}</p> : null}
      {saved ? (
        <p className="text-sm text-hq-success">
          {t("saved", { assigned: saved.assigned, moved: saved.moved })}
        </p>
      ) : null}
    </section>
  );
}

function EngineerRow({
  engineer,
  destination,
  teams,
  unknownRank,
  moveLabel,
  unplacedLabel,
  onMove,
}: {
  engineer: TeamBuilderPerson;
  destination: string;
  teams: TeamBuilderDraft["teams"];
  unknownRank: string;
  moveLabel: string;
  unplacedLabel: string;
  onMove: (commanderId: string, destination: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-hq-fg">
        {engineer.name}{" "}
        <span className="text-xs text-hq-fg-muted">{rankLabel(engineer.rank, unknownRank)}</span>
      </span>
      <select
        aria-label={moveLabel}
        value={destination}
        onChange={(event) => onMove(engineer.commanderId, event.target.value)}
        className="rounded-lg border border-hq-border bg-hq-surface px-2 py-1 text-xs text-hq-fg"
      >
        <option value="unplaced">{unplacedLabel}</option>
        {teams.map((team) => (
          <option key={team.wl.commanderId} value={team.wl.commanderId}>
            {team.wl.name}
          </option>
        ))}
      </select>
    </li>
  );
}
