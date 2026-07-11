"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  activeCount: number;
  minCount: number;
  engNames: string[];
};

export function EngCountBadge({ activeCount, minCount, engNames }: Props) {
  const t = useTranslations("professions");
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="text-xs text-hq-fg-muted underline decoration-dotted underline-offset-2 hover:text-hq-fg"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        aria-label={t("engCountTooltipLabel")}
      >
        {activeCount} / {minCount}
      </button>
      {open ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-xs text-hq-fg shadow-lg"
        >
          {engNames.length === 0 ? (
            <p className="text-hq-fg-muted">{t("noEngsOnTeam")}</p>
          ) : (
            <ul className="space-y-0.5">
              {engNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </span>
  );
}
