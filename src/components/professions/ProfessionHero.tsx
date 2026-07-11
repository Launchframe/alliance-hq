"use client";

import { Hammer, Medal, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { SwitchProfessionControl } from "@/components/professions/SwitchProfessionControl";
import { daysSince } from "@/lib/professions/coverage-time.shared";
import type { Profession } from "@/lib/professions/types";

type Props = {
  profession: Profession;
  professionSince: string | null;
  onSwitched: () => void;
};

export function ProfessionHero({ profession, professionSince, onSwitched }: Props) {
  const t = useTranslations("professions");
  const days = daysSince(professionSince);
  const Icon = profession === "War Leader" ? Medal : Hammer;

  return (
    <section className="rounded-xl border border-hq-border bg-gradient-to-br from-hq-surface to-hq-surface-muted p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
              profession === "War Leader"
                ? "bg-amber-500/15 text-amber-400"
                : "bg-sky-500/15 text-sky-400"
            }`}
          >
            <Icon className="h-9 w-9" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
              {t("currentProfession")}
            </p>
            <h1 className="text-2xl font-bold text-hq-fg">{profession}</h1>
            {days !== null ? (
              <p className="mt-1 text-sm text-hq-fg-muted">
                {t("daysInProfession", { count: days })}
              </p>
            ) : null}
          </div>
        </div>
        <SwitchProfessionControl
          currentProfession={profession}
          onSwitched={onSwitched}
          icon={<RotateCcw className="h-4 w-4" />}
        />
      </div>
    </section>
  );
}
