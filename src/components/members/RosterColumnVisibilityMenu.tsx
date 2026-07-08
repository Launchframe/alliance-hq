"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  ROSTER_COLUMN_IDS,
  rosterColumnAlwaysVisible,
  type RosterColumnId,
} from "@/lib/members/roster-index.shared";

type Props = {
  visibility: Record<RosterColumnId, boolean>;
  onToggle: (columnId: RosterColumnId, nextVisible: boolean) => void;
};

export function RosterColumnVisibilityMenu({ visibility, onToggle }: Props) {
  const t = useTranslations("members.rosterColumns");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        className="w-full rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm hover:bg-hq-border sm:w-auto"
      >
        {t("menuLabel")}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 min-w-[14rem] rounded-xl border border-hq-border bg-hq-surface p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
            {t("menuTitle")}
          </p>
          <ul className="space-y-2">
            {ROSTER_COLUMN_IDS.map((columnId) => {
              const locked = rosterColumnAlwaysVisible(columnId);
              return (
                <li key={columnId}>
                  <label className="flex items-center gap-2 text-sm text-hq-fg">
                    <input
                      type="checkbox"
                      checked={visibility[columnId]}
                      disabled={locked}
                      onChange={(event) =>
                        onToggle(columnId, event.target.checked)
                      }
                    />
                    <span className={locked ? "text-hq-fg-muted" : undefined}>
                      {t(`col.${columnId}`)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
