"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { formatCoverageHourLabel } from "@/lib/professions/coverage-time.shared";
import type { AssignedEngRow, MyWlTeamContext } from "@/lib/professions/types";

function formatSince(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function coverageLabel(eng: AssignedEngRow): string {
  if (eng.coverageStartHour === null || eng.coverageEndHour === null) return "Not set";
  return `${formatCoverageHourLabel(eng.coverageStartHour, "local")} – ${formatCoverageHourLabel(eng.coverageEndHour, "local")}`;
}

function CoverageBar({ engs }: { engs: AssignedEngRow[] }) {
  const t = useTranslations("professions");
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
        <p className="text-xs text-hq-fg-muted">{t("coverage24hUtc")}</p>
        {gapHours > 0 ? (
          <span className="rounded bg-hq-warning/15 px-1.5 py-0.5 text-[10px] text-hq-warning">
            {t("gapHours", { count: gapHours })}
          </span>
        ) : null}
        {gapHours === 0 && engs.length > 0 ? (
          <span className="rounded bg-hq-success/15 px-1.5 py-0.5 text-[10px] text-hq-success">
            {t("fullCoverage")}
          </span>
        ) : null}
      </div>
      <div className="flex h-4 overflow-hidden rounded border border-hq-border">
        {cells.map((covered, i) => (
          <div
            key={i}
            className={`flex-1 ${covered ? "bg-hq-success" : "bg-hq-surface-muted"}`}
            title={`${String(i).padStart(2, "0")}:00 UTC`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-hq-fg-muted">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

type Props = {
  teamContext: (MyWlTeamContext & { profession: "War Leader" }) | null;
  onRefresh: () => void;
};

export function WLView({ teamContext, onRefresh }: Props) {
  const t = useTranslations("professions");
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
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setDismissError(json.error ?? t("dismissFailed"));
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
    <div className="max-w-xl space-y-6">
      <div className="flex items-center justify-end">
        <span
          className={`rounded px-2 py-1 text-xs font-medium ${
            isCovered
              ? "bg-hq-success/15 text-hq-success"
              : "bg-hq-warning/15 text-hq-warning"
          }`}
        >
          {isCovered
            ? t("coveredCount", { count: activeEngs.length, min: minEngsPerTeam })
            : t("needsSupportCount", { count: activeEngs.length, min: minEngsPerTeam })}
        </span>
      </div>

      {activeEngs.length > 0 ? <CoverageBar engs={activeEngs} /> : null}

      <section className="space-y-3 rounded-xl border border-hq-border p-4">
        <h2 className="text-sm font-semibold text-hq-fg">
          {t("assignedEngCount", { count: activeEngs.length })}
        </h2>

        {activeEngs.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">{t("noEngsAssignedWl")}</p>
        ) : (
          <ul className="divide-y divide-hq-border overflow-hidden rounded-lg border border-hq-border">
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
                    {t("assignedSince")} {formatSince(eng.assignedAt)} · {coverageLabel(eng)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void dismissEng(eng.engCommanderId)}
                  disabled={dismissing === eng.engCommanderId}
                  className="text-hq-danger hover:text-hq-danger"
                >
                  {dismissing === eng.engCommanderId ? t("removing") : t("dismissEng")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {dismissError ? <p className="text-xs text-hq-danger">{dismissError}</p> : null}
      </section>

      <div className="border-t border-hq-border pt-2">
        {moreRequested ? (
          <p className="text-sm text-hq-success">{t("requestSent")}</p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void requestMoreEngs()}
            disabled={requestingMore}
          >
            {requestingMore ? t("sending") : t("requestMoreEngs")}
          </Button>
        )}
      </div>
    </div>
  );
}
