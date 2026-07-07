"use client";

import { ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  DISCORD_BOT_GUIDE_ROLE_RECOVERY_STEPS,
  DISCORD_BOT_GUIDE_ROLE_STEPS,
  DISCORD_BOT_GUIDE_STEPS,
  stepSlugToMessageKey,
  type DiscordBotGuideRoleSlug,
} from "@/lib/guides/discord-bot-guide.shared";
type Props = {
  role: DiscordBotGuideRoleSlug;
};

export function DiscordBotGuideFlowchart({ role }: Props) {
  const t = useTranslations("guides.discordBot");
  const steps = DISCORD_BOT_GUIDE_ROLE_STEPS[role];
  const recoverySteps = DISCORD_BOT_GUIDE_ROLE_RECOVERY_STEPS[role] ?? [];

  const renderStep = (
    stepSlug: string,
    index: number,
    isLast: boolean,
    showNumber: boolean,
  ) => {
    const def = DISCORD_BOT_GUIDE_STEPS[stepSlug];
    const messageKey = stepSlugToMessageKey(stepSlug);

    return (
      <li key={stepSlug} className="flex min-w-0 flex-col items-stretch">
        <Link
          href={`/guides/discord-bot/${role}/${stepSlug}`}
          className={
            def?.optional
              ? "group block min-w-0 rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/50 px-4 py-4 transition-colors hover:border-[#58a6ff]/50 hover:bg-[#161b22]"
              : "group block min-w-0 rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-4 transition-colors hover:border-[#58a6ff]/60 hover:bg-[#1c2128]"
          }
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#21262d] text-xs font-semibold text-[#58a6ff]"
              aria-hidden
            >
              {showNumber ? index + 1 : "↩"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug group-hover:text-[#58a6ff]">
                {t(`steps.${messageKey}.title`)}
              </p>
              {def?.optional ? (
                <p className="mt-1 text-xs text-[#6e7681]">{t("flow.optional")}</p>
              ) : null}
            </div>
          </div>
        </Link>
        {!isLast ? (
          <div className="flex justify-center py-1 text-[#30363d]" aria-hidden>
            <ArrowDown className="h-5 w-5" />
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-lg min-w-0 flex-col gap-6 pb-12">
      <header className="space-y-2">
        <p>
          <Link
            href="/guides/discord-bot"
            className="text-sm text-[#58a6ff] hover:underline"
          >
            {t("flow.backToRoles")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`roles.${role}.title`)}
        </h1>
        <p className="text-sm text-[#8b949e]">{t(`roles.${role}.description`)}</p>
        <p className="text-sm text-[#6e7681]">{t("flow.tapStep")}</p>
      </header>

      <ol className="flex min-w-0 flex-col items-stretch gap-0">
        {steps.map((stepSlug, index) =>
          renderStep(stepSlug, index, index === steps.length - 1, true),
        )}
      </ol>

      {recoverySteps.length > 0 ? (
        <section className="space-y-3 border-t border-[#30363d] pt-6">
          <h2 className="text-lg font-medium">{t("flow.recoveryTitle")}</h2>
          <p className="text-sm text-[#8b949e]">{t("flow.recoveryBody")}</p>
          <ol className="flex min-w-0 flex-col items-stretch gap-0">
            {recoverySteps.map((stepSlug, index) =>
              renderStep(
                stepSlug,
                index,
                index === recoverySteps.length - 1,
                false,
              ),
            )}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
