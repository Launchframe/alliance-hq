"use client";

import {
  Check,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleSlash,
  Clock,
  Hourglass,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  formatVsScore,
  vsMemberDayMessage,
} from "@/lib/vs-performance/member-performance-view.shared";
import type { VsMemberDay } from "@/lib/vs-performance/member-performance.shared";

const DAY_STATE_ICONS: Record<VsMemberDay["state"], typeof Check> = {
  open: CircleDashed,
  in_progress: Clock,
  met: Check,
  missed: X,
  excused: CircleSlash,
  pending_excusal: Hourglass,
  missing: Minus,
  conflict: TriangleAlert,
  unverified: CircleHelp,
  recorded: CircleDot,
};

export function VsDayBadge({ day, dayName }: { day: VsMemberDay; dayName: string }) {
  const t = useTranslations("vsPerformance.members");
  const locale = useLocale();
  const { key, args } = vsMemberDayMessage(day);
  const stateLabel = t(key, args.score !== undefined ? { score: formatVsScore(args.score, locale) } : {});
  const Icon = DAY_STATE_ICONS[day.state];
  const accessibleLabel = `${t("dayCell", { day: dayName, state: stateLabel })}${
    day.source === "derived" ? ` — ${t("derived")}` : ""
  }`;
  return (
    <span className="inline-flex flex-col items-center" title={stateLabel}>
      <span aria-hidden className="inline-flex flex-col items-center">
        {day.score !== null ? (
          <span className="tabular-nums text-hq-fg">{formatVsScore(day.score, locale)}</span>
        ) : (
          <span className="text-hq-fg-muted">—</span>
        )}
        <Icon className="h-3 w-3 text-hq-fg-muted" strokeWidth={2.5} />
      </span>
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  );
}
