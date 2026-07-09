"use client";

import { useState } from "react";

import { FindWLWizard } from "@/components/professions/FindWLWizard";
import { SwitchProfessionControl } from "@/components/professions/SwitchProfessionControl";
import { Button } from "@/components/ui/button";
import type { MyEngTeamContext } from "@/lib/professions/types";

function formatHour(h: number | null): string {
  if (h === null) return "—";
  const label = h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
  return `${String(h).padStart(2, "0")}:00 UTC (${label})`;
}

function CoverageBar({ engs }: { engs: Array<{ coverageStartHour: number | null; coverageEndHour: number | null; engName: string | null }> }) {
  const cells = Array.from({ length: 24 }, (_, i) => {
    const covered = engs.some((e) => {
      if (e.coverageStartHour === null || e.coverageEndHour === null) return false;
      if (e.coverageStartHour <= e.coverageEndHour) {
        return i >= e.coverageStartHour && i < e.coverageEndHour;
      }
      // Wraps midnight
      return i >= e.coverageStartHour || i < e.coverageEndHour;
    });
    return covered;
  });

  return (
    <div className="mt-3">
      <p className="text-xs text-hq-fg-muted mb-1">24h coverage (UTC)</p>
      <div className="flex h-4 rounded overflow-hidden border border-hq-border">
        {cells.map((covered, i) => (
          <div
            key={i}
            className={`flex-1 ${covered ? "bg-hq-success" : "bg-hq-surface-muted"}`}
            title={`${String(i).padStart(2, "0")}:00 UTC — ${covered ? "covered" : "gap"}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-hq-fg-muted mt-0.5">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

type Props = {
  teamContext: (MyEngTeamContext & { profession: "Engineer" }) | null;
  onRefresh: () => void;
};

export function EngView({ teamContext, onRefresh }: Props) {
  const [showWizard, setShowWizard] = useState(false);
  const [startHour, setStartHour] = useState<string>(
    String(teamContext?.assignment?.coverageStartHour ?? ""),
  );
  const [endHour, setEndHour] = useState<string>(
    String(teamContext?.assignment?.coverageEndHour ?? ""),
  );
  const [savingCoverage, setSavingCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const assignment = teamContext?.assignment ?? null;
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
          coverageStartHour: startHour !== "" ? Number(startHour) : null,
          coverageEndHour: endHour !== "" ? Number(endHour) : null,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setCoverageError(json.error ?? "Failed to save.");
      } else {
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
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setLeaveError(json.error ?? "Failed to leave team.");
      } else {
        onRefresh();
      }
    } finally {
      setLeaving(false);
    }
  }

  if (showWizard || !assignment) {
    return (
      <FindWLWizard
        onAssigned={() => {
          setShowWizard(false);
          onRefresh();
        }}
        onCancel={assignment ? () => setShowWizard(false) : undefined}
        onProfessionSwitched={onRefresh}
      />
    );
  }

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-hq-fg">Profession Hub</h1>
          <p className="text-sm text-hq-fg-muted">Engineer</p>
        </div>
        <SwitchProfessionControl
          currentProfession="Engineer"
          onSwitched={onRefresh}
        />
      </div>

      {/* Current assignment */}
      <section className="border border-hq-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-hq-fg">Your War Leader</h2>
          {isOverStaffed && (
            <span className="text-xs bg-hq-warning/20 text-hq-warning px-2 py-0.5 rounded">
              Team over target ({teamEngCount}/{minEngsPerTeam})
            </span>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-hq-fg">
            {assignment.wlName ?? assignment.wlCommanderId}
          </p>
          <p className="text-xs text-hq-fg-muted">
            Assigned {new Date(assignment.assignedAt).toLocaleDateString()}
          </p>
        </div>

        {/* Coverage bar showing all Engs on this team */}
        <CoverageBar
          engs={[{
            coverageStartHour: assignment.coverageStartHour,
            coverageEndHour: assignment.coverageEndHour,
            engName: null,
          }]}
        />

        {/* Coverage window editor */}
        <div className="pt-2 space-y-2">
          <p className="text-xs font-medium text-hq-fg">Your coverage window (UTC hours, 0–23)</p>
          <div className="flex items-center gap-3">
            <label className="text-xs text-hq-fg-muted w-20">Start hour</label>
            <input
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(e) => setStartHour(e.target.value)}
              placeholder="e.g. 14"
              className="w-20 rounded border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-hq-fg-muted w-20">End hour</label>
            <input
              type="number"
              min={0}
              max={23}
              value={endHour}
              onChange={(e) => setEndHour(e.target.value)}
              placeholder="e.g. 22"
              className="w-20 rounded border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg"
            />
          </div>
          {coverageError && <p className="text-xs text-hq-danger">{coverageError}</p>}
          <Button size="sm" onClick={saveCoverage} disabled={savingCoverage}>
            Save coverage window
          </Button>
        </div>

        {/* Leave / switch */}
        <div className="pt-2 border-t border-hq-border flex items-center gap-3">
          {(isOverStaffed) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWizard(true)}
            >
              Find another War Leader
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={leaveTeam}
            disabled={leaving}
          >
            Leave team
          </Button>
          {leaveError && <p className="text-xs text-hq-danger ml-2">{leaveError}</p>}
        </div>
      </section>
    </div>
  );
}
