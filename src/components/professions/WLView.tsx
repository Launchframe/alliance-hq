"use client";

import { useState } from "react";

import { SwitchProfessionControl } from "@/components/professions/SwitchProfessionControl";
import { Button } from "@/components/ui/button";
import type { AssignedEngRow, MyWlTeamContext } from "@/lib/professions/types";

function formatSince(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function coverageLabel(eng: AssignedEngRow): string {
  if (eng.coverageStartHour === null || eng.coverageEndHour === null) return "Not set";
  return `${String(eng.coverageStartHour).padStart(2, "0")}:00 – ${String(eng.coverageEndHour).padStart(2, "0")}:00 UTC`;
}

function CoverageBar({ engs }: { engs: AssignedEngRow[] }) {
  const cells = Array.from({ length: 24 }, (_, i) => {
    return engs.some((e) => {
      if (e.coverageStartHour === null || e.coverageEndHour === null) return false;
      if (e.coverageStartHour <= e.coverageEndHour) {
        return i >= e.coverageStartHour && i < e.coverageEndHour;
      }
      return i >= e.coverageStartHour || i < e.coverageEndHour;
    });
  });

  const gapHours = cells.filter((c) => !c).length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs text-hq-fg-muted">24h Win-Win coverage (UTC)</p>
        {gapHours > 0 && (
          <span className="text-[10px] bg-hq-warning/15 text-hq-warning px-1.5 py-0.5 rounded">
            {gapHours}h gap
          </span>
        )}
        {gapHours === 0 && engs.length > 0 && (
          <span className="text-[10px] bg-hq-success/15 text-hq-success px-1.5 py-0.5 rounded">
            Full coverage
          </span>
        )}
      </div>
      <div className="flex h-4 rounded overflow-hidden border border-hq-border">
        {cells.map((covered, i) => (
          <div
            key={i}
            className={`flex-1 ${covered ? "bg-hq-success" : "bg-hq-surface-muted"}`}
            title={`${String(i).padStart(2, "0")}:00 UTC`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-hq-fg-muted">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

type Props = {
  teamContext: (MyWlTeamContext & { profession: "War Leader" }) | null;
  onRefresh: () => void;
};

export function WLView({ teamContext, onRefresh }: Props) {
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [requestingMore, setRequestingMore] = useState(false);
  const [moreRequested, setMoreRequested] = useState(false);

  const activeEngs = teamContext?.activeEngs ?? [];
  const minEngsPerTeam = teamContext?.minEngsPerTeam ?? 2;
  const isCovered = teamContext?.isCovered ?? false;

  async function dismissEng(engCommanderId: string) {
    setDismissing(engCommanderId);
    setDismissError(null);
    try {
      const res = await fetch("/api/professions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engCommanderId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setDismissError(json.error ?? "Dismiss failed.");
      } else {
        onRefresh();
      }
    } finally {
      setDismissing(null);
    }
  }

  async function requestMoreEngs() {
    setRequestingMore(true);
    try {
      await fetch("/api/professions/request-more", { method: "POST" });
      setMoreRequested(true);
    } finally {
      setRequestingMore(false);
    }
  }

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-hq-fg">Profession Hub</h1>
          <p className="text-sm text-hq-fg-muted">War Leader</p>
        </div>
        <div className="flex items-center gap-2">
          <SwitchProfessionControl
            currentProfession="War Leader"
            onSwitched={onRefresh}
          />
          <span
            className={`text-xs px-2 py-1 rounded font-medium ${
              isCovered
                ? "bg-hq-success/15 text-hq-success"
                : "bg-hq-warning/15 text-hq-warning"
            }`}
          >
            {isCovered
              ? `Covered (${activeEngs.length}/${minEngsPerTeam})`
              : `Needs support (${activeEngs.length}/${minEngsPerTeam})`}
          </span>
        </div>
      </div>

      {/* Coverage visualization */}
      {activeEngs.length > 0 && <CoverageBar engs={activeEngs} />}

      {/* Eng list */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-hq-fg">
          Your Engineers ({activeEngs.length})
        </h2>

        {activeEngs.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">
            No Engineers assigned yet. Request support from your officers.
          </p>
        ) : (
          <ul className="divide-y divide-hq-border border border-hq-border rounded-lg overflow-hidden">
            {activeEngs.map((eng) => (
              <li
                key={eng.assignmentId}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-hq-fg">
                    {eng.engName ?? eng.engCommanderId}
                  </p>
                  <p className="text-xs text-hq-fg-muted">
                    Since {formatSince(eng.assignedAt)} · {coverageLabel(eng)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismissEng(eng.engCommanderId)}
                  disabled={dismissing === eng.engCommanderId}
                  className="text-hq-danger hover:text-hq-danger"
                >
                  {dismissing === eng.engCommanderId ? "Removing…" : "Dismiss"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {dismissError && (
          <p className="text-xs text-hq-danger">{dismissError}</p>
        )}
      </section>

      {/* Request more */}
      <div className="pt-2 border-t border-hq-border">
        {moreRequested ? (
          <p className="text-sm text-hq-success">
            Request sent. Officers and the profession channel have been notified.
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={requestMoreEngs}
            disabled={requestingMore}
          >
            {requestingMore ? "Sending…" : "Request more Engineers"}
          </Button>
        )}
      </div>
    </div>
  );
}
