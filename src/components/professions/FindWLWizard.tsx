"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { EngCountBadge } from "@/components/professions/EngCountBadge";
import { Button } from "@/components/ui/button";
import type { WlSuggestion } from "@/lib/professions/types";

type Props = {
  onAssigned: () => void;
  onCancel?: () => void;
  embedded?: boolean;
};

export function FindWLWizard({ onAssigned, onCancel, embedded = false }: Props) {
  const t = useTranslations("professions");
  const [suggestions, setSuggestions] = useState<WlSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [choosingRandom, setChoosingRandom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/professions/suggestions");
        if (res.ok) {
          const data = (await res.json()) as { suggestions: WlSuggestion[] };
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
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? t("assignFailed"));
      } else {
        onAssigned();
      }
    } finally {
      setAssigning(null);
    }
  }

  async function chooseForMe() {
    setChoosingRandom(true);
    setError(null);
    try {
      const res = await fetch("/api/professions/assign-random", {
        method: "POST",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? t("assignFailed"));
      } else {
        onAssigned();
      }
    } finally {
      setChoosingRandom(false);
    }
  }

  const wrapperClass = embedded ? "space-y-4" : "p-6 max-w-xl space-y-5";

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{t("wlSupportTitle")}</h2>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("wlSupportDesc")}</p>
        </div>
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("switchCancel")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void chooseForMe()}
          disabled={choosingRandom || loading}
        >
          {choosingRandom ? t("choosingForMe") : t("chooseForMe")}
        </Button>
      </div>

      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-hq-fg-muted animate-pulse">{t("loadingWls")}</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("noWlsAvailable")}</p>
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
                  <EngCountBadge
                    activeCount={s.activeEngCount}
                    minCount={s.minEngsPerTeam}
                    engNames={s.assignedEngNames}
                  />
                  {s.isCovered ? (
                    <span className="rounded bg-hq-success/15 px-1.5 py-0.5 text-[10px] text-hq-success">
                      {t("covered")}
                    </span>
                  ) : (
                    <span className="rounded bg-hq-warning/15 px-1.5 py-0.5 text-[10px] text-hq-warning">
                      {t("needsSupport")}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant={s.isCovered ? "outline" : "default"}
                onClick={() => void assign(s.wlCommanderId)}
                disabled={assigning === s.wlCommanderId}
              >
                {assigning === s.wlCommanderId ? t("joining") : t("assignBtn")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
