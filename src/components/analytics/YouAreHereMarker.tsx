"use client";

import { useTranslations } from "next-intl";

type Props = {
  label?: string;
  className?: string;
};

export function YouAreHereLegend({ label, className }: Props) {
  const t = useTranslations("dashboard");
  return (
    <div className={`flex items-center gap-2 text-xs text-hq-fg-muted ${className ?? ""}`}>
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f78166] ring-2 ring-[#f78166]/30" />
      <span>{label ?? t("youAreHere")}</span>
    </div>
  );
}

export const VIEWER_MARKER_COLOR = "#f78166";
