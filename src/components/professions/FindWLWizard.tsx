"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { WlSuggestion } from "@/lib/professions/types";

type Props = {
  onAssigned: () => void;
  /** If undefined, no cancel affordance is shown (first-time wizard). */
  onCancel?: () => void;
};

export function FindWLWizard({ onAssigned, onCancel }: Props) {
  const [suggestions, setSuggestions] = useState<WlSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/professions/suggestions");
        if (res.ok) {
          const data = await res.json() as { suggestions: WlSuggestion[] };
          setSuggestions(data.suggestions);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function assign(wlCommanderId: string) {
    setAssigning(wlCommanderId);
    setError(null);
    try {
      const res = await fetch("/api/professions/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wlCommanderId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Assignment failed.");
      } else {
        onAssigned();
      }
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="p-6 max-w-xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-hq-fg">Find a War Leader</h1>
          <p className="text-sm text-hq-fg-muted mt-1">
            Pick a War Leader to support. War Leaders with fewer Engineers are shown first.
          </p>
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-hq-danger">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-hq-fg-muted animate-pulse">Loading War Leaders…</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">
          No War Leaders found in your alliance, or all have enough Engineers.
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li
              key={s.wlCommanderId}
              className="flex items-center justify-between rounded-lg border border-hq-border px-4 py-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-hq-fg">
                  {s.wlName ?? s.wlCommanderId}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-hq-fg-muted">
                    {s.activeEngCount} / needs {s.activeEngCount < 2 ? "2+" : s.activeEngCount + "+"} Engineers
                  </span>
                  {s.isCovered ? (
                    <span className="text-[10px] bg-hq-success/15 text-hq-success px-1.5 py-0.5 rounded">
                      Covered
                    </span>
                  ) : (
                    <span className="text-[10px] bg-hq-warning/15 text-hq-warning px-1.5 py-0.5 rounded">
                      Needs support
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant={s.isCovered ? "outline" : "default"}
                onClick={() => assign(s.wlCommanderId)}
                disabled={assigning === s.wlCommanderId}
              >
                {assigning === s.wlCommanderId ? "Joining…" : "Join team"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
