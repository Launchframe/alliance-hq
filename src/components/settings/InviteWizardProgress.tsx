"use client";

import { useTranslations } from "next-intl";

import type { InviteWizardStep, InviteWizardType } from "@/lib/settings/invite-wizard.shared";

type Props = {
  step: InviteWizardStep;
  inviteType: InviteWizardType | null;
};

export function InviteWizardProgress({ step, inviteType }: Props) {
  const t = useTranslations("team.invites.wizard");

  const steps: Array<{ id: InviteWizardStep; label: string }> = [
    { id: 1, label: t("stepType") },
    { id: 2, label: t("stepTargets") },
    { id: 3, label: t("stepGenerate") },
  ];

  return (
    <nav aria-label={t("progressLabel")} className="mb-6">
      <ol className="flex flex-wrap gap-2 sm:gap-4">
        {steps.map((item) => {
          const isCurrent = item.id === step;
          const isComplete = item.id < step;
          const isFuture = item.id > step;
          return (
            <li
              key={item.id}
              className={
                isCurrent
                  ? "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#388bfd]/40 bg-[#388bfd]/10 px-3 py-2 text-sm text-[#58a6ff]"
                  : isComplete
                    ? "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#30363d] px-3 py-2 text-sm text-[#3fb950]"
                    : "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#30363d] px-3 py-2 text-sm text-[#6e7681]"
              }
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                className={
                  isCurrent
                    ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#388bfd] text-xs font-semibold text-white"
                    : isComplete
                      ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#238636] text-xs font-semibold text-white"
                      : "flex size-6 shrink-0 items-center justify-center rounded-full border border-[#30363d] text-xs font-semibold"
                }
              >
                {item.id}
              </span>
              <span className="min-w-0 truncate font-medium">{item.label}</span>
              {isFuture && inviteType === null && item.id > 1 ? null : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
