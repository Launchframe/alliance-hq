"use client";

import { Check, ChevronDown, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import type {
  AllianceSetupGuideTaskId,
  AllianceSetupGuideTaskStatus,
} from "@/lib/alliance-setup-guide-status.shared";

export type AllianceSetupGuidePanelVariant = "dashboard" | "settings";

export type AllianceSetupGuidePanelProps = {
  tasks: AllianceSetupGuideTaskStatus[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  variant: AllianceSetupGuidePanelVariant;
  onTaskAction: (id: AllianceSetupGuideTaskId) => void;
  className?: string;
};

function ProgressRing({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div
      className="relative h-16 w-16 shrink-0"
      aria-label={`${completed} of ${total} steps complete`}
    >
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="#30363d"
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="#58a6ff"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">
        {completed}/{total}
      </span>
    </div>
  );
}

export function AllianceSetupGuidePanel({
  tasks,
  completedCount,
  totalCount,
  allComplete,
  variant,
  onTaskAction,
  className,
}: AllianceSetupGuidePanelProps) {
  const t = useTranslations("allianceSetupGuide");
  const [showAllTasks, setShowAllTasks] = useState(false);

  const rows = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        title: t(`tasks.${task.id}.title`),
        helper: t(`tasks.${task.id}.helper`),
        action: t(`tasks.${task.id}.action`),
      })),
    [tasks, t],
  );

  const nextRow = rows.find((row) => !row.complete);
  const compactDashboard = variant === "dashboard";
  const visibleRows =
    compactDashboard && !showAllTasks ? (nextRow ? [nextRow] : []) : rows;

  return (
    <div
      className={`rounded-2xl border border-[#30363d] bg-[#161b22] p-4 sm:p-6 min-w-0 w-full max-w-full${className ? ` ${className}` : ""}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 min-w-0">
        <ProgressRing completed={completedCount} total={totalCount} />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {allComplete ? t("allCompleteTitle") : t("title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allComplete ? t("allCompleteBody") : t("subtitle")}
          </p>
        </div>
        {compactDashboard && !allComplete && rows.length > 1 ? (
          <button
            type="button"
            onClick={() => setShowAllTasks((value) => !value)}
            className="inline-flex items-center gap-1 text-xs text-[#58a6ff] hover:underline shrink-0"
          >
            {showAllTasks ? t("showLess") : t("showAll")}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform${showAllTasks ? " rotate-180" : ""}`}
            />
          </button>
        ) : null}
      </div>

      <ul className="mt-4 space-y-2 min-w-0">
        {visibleRows.map((row) => (
          <li
            key={row.id}
            className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl border px-3 py-3 min-w-0 ${
              row.complete
                ? "border-[#23863666] bg-[#2386361a]"
                : "border-[#30363d] bg-[#0d1117]"
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              {row.complete ? (
                <Check className="h-4 w-4 text-[#3fb950] shrink-0 mt-0.5" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-[#8b949e] shrink-0 mt-0.5" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{row.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{row.helper}</p>
              </div>
            </div>
            {!row.complete ? (
              <button
                type="button"
                onClick={() => onTaskAction(row.id)}
                className="w-full sm:w-auto shrink-0 rounded-lg bg-[#238636] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2ea043]"
              >
                {row.action}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
