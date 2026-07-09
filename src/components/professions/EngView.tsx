"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { FindWLWizard } from "@/components/professions/FindWLWizard";
import { TimeClockPicker } from "@/components/professions/TimeClockPicker";
import { Button } from "@/components/ui/button";
import {
  formatCoverageHourLabel,
  type CoverageDisplayZone,
} from "@/lib/professions/coverage-time.shared";
import type { AssignedEngRow, MyEngTeamContext } from "@/lib/professions/types";

function CoverageBar({
  engs,
  zone,
}: {
  engs: Array<{
    coverageStartHour: number | null;
    coverageEndHour: number | null;
    engName: string | null;
  }>;
  zone: CoverageDisplayZone;
}) {
  const t = useTranslations("professions");
  const cells = Array.from({ length: 24 }, (_, i) => {
    const covered = engs.some((e) => {
      if (e.coverageStartHour === null || e.coverageEndHour === null) return false;
      if (e.coverageStartHour <= e.coverageEndHour) {
        return i >= e.coverageStartHour && i < e.coverageEndHour;
      }
      return i >= e.coverageStartHour || i < e.coverageEndHour;
    });
    return covered;
  });

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-hq-fg-muted">
        {t("coverage24h", { zone: zone === "local" ? t("localTime") : t("serverTime") })}
      </p>
      <div className="flex h-4 overflow-hidden rounded border border-hq-border">
        {cells.map((covered, i) => (
          <div
            key={i}
            className={`flex-1 ${covered ? "bg-hq-success" : "bg-hq-surface-muted"}`}
            title={formatCoverageHourLabel(i, zone)}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-hq-fg-muted">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

function formatSince(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function coverageLabel(
  eng: AssignedEngRow,
  zone: CoverageDisplayZone,
): string {
  if (eng.coverageStartHour === null || eng.coverageEndHour === null) return "Not set";
  return `${formatCoverageHourLabel(eng.coverageStartHour, zone)} – ${formatCoverageHourLabel(eng.coverageEndHour, zone)}`;
}

type Props = {
  teamContext: (MyEngTeamContext & { profession: "Engineer" }) | null;
  onRefresh: () => void;
};

export function EngView({ teamContext, onRefresh }: Props) {
  const t = useTranslations("professions");
  const [showWizard, setShowWizard] = useState(false);
  const serverStart = teamContext?.assignment?.coverageStartHour ?? null;
  const serverEnd = teamContext?.assignment?.coverageEndHour ?? null;
  const [draftStart, setDraftStart] = useState<number | null>(null);
  const [draftEnd, setDraftEnd] = useState<number | null>(null);
  const startUtc = draftStart ?? serverStart;
  const endUtc = draftEnd ?? serverEnd;
  const [timeZone, setTimeZone] = useState<CoverageDisplayZone>("local");
  const [savingCoverage, setSavingCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const assignment = teamContext?.assignment ?? null;
  const teamEngs = teamContext?.teamEngs ?? [];
  const minEngsPerTeam = teamContext?.minEngsPerTeam ?? 2;
  const teamEngCount = teamContext?.teamEngCount ?? 0;
  const isOverStaffed = assignment !== null && teamEngCount > minEngsPerTeam;

  async function saveCoverage() {
    setSavingCoverage(true);
    setCoverageError(null);
    try {
      const res = await fetch("/api/professions/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverageStartHour: startUtc,
          coverageEndHour: endUtc,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setCoverageError(json.error ?? t("saveCoverageFailed"));
      } else {
        setDraftStart(null);
        setDraftEnd(null);
        onRefresh();
      }
    } finally {
      setSavingCoverage(false);
    }
  }

  async function leaveTeam() {
    setLeaving(true);
    setLeaveError(null);
    try {
      const res = await fetch("/api/professions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setLeaveError(json.error ?? t("leaveFailed"));
      } else {
        onRefresh();
      }
    } finally {
      setLeaving(false);
    }
  }

  if (showWizard || !assignment) {
    return (
      <section className="rounded-xl border border-hq-border p-4">
        <FindWLWizard
          embedded
          onAssigned={() => {
            setShowWizard(false);
            onRefresh();
          }}
          onCancel={assignment ? () => setShowWizard(false) : undefined}
        />
      </section>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <section className="space-y-3 rounded-xl border border-hq-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-hq-fg">{t("yourWL")}</h2>
          {isOverStaffed ? (
            <span className="rounded bg-hq-warning/20 px-2 py-0.5 text-xs text-hq-warning">
              {t("teamOverTarget", { count: teamEngCount, min: minEngsPerTeam })}
            </span>
          ) : null}
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-hq-fg">
            {assignment.wlName ?? assignment.wlCommanderId}
          </p>
          <p className="text-xs text-hq-fg-muted">
            {t("assignedSince")} {formatSince(assignment.assignedAt)}
          </p>
        </div>

        <CoverageBar engs={teamEngs} zone={timeZone} />

        <div className="space-y-3 border-t border-hq-border pt-3">
          <h3 className="text-sm font-semibold text-hq-fg">
            {t("teamEngineers", { count: teamEngs.length })}
          </h3>
          {teamEngs.length === 0 ? (
            <p className="text-sm text-hq-fg-muted">{t("noEngsAssigned")}</p>
          ) : (
            <ul className="divide-y divide-hq-border overflow-hidden rounded-lg border border-hq-border">
              {teamEngs.map((eng) => (
                <li key={eng.assignmentId} className="px-4 py-2.5">
                  <p className="text-sm font-medium text-hq-fg">
                    {eng.engName ?? eng.engCommanderId}
                  </p>
                  <p className="text-xs text-hq-fg-muted">
                    {t("assignedSince")} {formatSince(eng.assignedAt)} ·{" "}
                    {coverageLabel(eng, timeZone)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t border-hq-border pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-hq-fg">{t("coverageWindow")}</p>
            <div className="flex rounded-lg border border-hq-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTimeZone("local")}
                className={`rounded-md px-2 py-1 ${
                  timeZone === "local"
                    ? "bg-hq-accent text-white"
                    : "text-hq-fg-muted"
                }`}
              >
                {t("localTime")}
              </button>
              <button
                type="button"
                onClick={() => setTimeZone("server")}
                className={`rounded-md px-2 py-1 ${
                  timeZone === "server"
                    ? "bg-hq-accent text-white"
                    : "text-hq-fg-muted"
                }`}
              >
                {t("serverTime")}
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TimeClockPicker
              label={t("coverageStartHour")}
              utcHour={startUtc}
              zone={timeZone}
              onChange={setDraftStart}
            />
            <TimeClockPicker
              label={t("coverageEndHour")}
              utcHour={endUtc}
              zone={timeZone}
              onChange={setDraftEnd}
            />
          </div>
          {coverageError ? (
            <p className="text-xs text-hq-danger">{coverageError}</p>
          ) : null}
          <Button size="sm" onClick={() => void saveCoverage()} disabled={savingCoverage}>
            {savingCoverage ? t("savingCoverage") : t("saveCoverage")}
          </Button>
        </div>

        <div className="flex items-center gap-3 border-t border-hq-border pt-3">
          {isOverStaffed ? (
            <Button variant="ghost" size="sm" onClick={() => setShowWizard(true)}>
              {t("findAnotherWl")}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void leaveTeam()}
            disabled={leaving}
          >
            {leaving ? t("leaving") : t("leaveTeam")}
          </Button>
          {leaveError ? <p className="ml-2 text-xs text-hq-danger">{leaveError}</p> : null}
        </div>
      </section>
    </div>
  );
}
