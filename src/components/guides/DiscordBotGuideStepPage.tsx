"use client";

import { useTranslations } from "next-intl";

import { GuideScreenshotSlot } from "@/components/guides/GuideScreenshotSlot";
import { Link } from "@/i18n/navigation";
import {
  DISCORD_BOT_GUIDE_SCREENSHOTS,
  DISCORD_BOT_GUIDE_STEPS,
  guideStepsForRole,
  stepSlugToMessageKey,
  type DiscordBotGuideRoleSlug,
} from "@/lib/guides/discord-bot-guide.shared";

type Props = {
  role: DiscordBotGuideRoleSlug;
  stepSlug: string;
};

export function DiscordBotGuideStepPage({ role, stepSlug }: Props) {
  const t = useTranslations("guides.discordBot");
  const messageKey = stepSlugToMessageKey(stepSlug);
  const def = DISCORD_BOT_GUIDE_STEPS[stepSlug];
  const steps = guideStepsForRole(role);
  const stepIndex = steps.indexOf(stepSlug);
  const prevSlug = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextSlug =
    stepIndex >= 0 && stepIndex < steps.length - 1
      ? steps[stepIndex + 1]
      : null;

  const command = def?.showCommand ? t(`steps.${messageKey}.command`) : null;

  const tip = def?.showTip ? t(`steps.${messageKey}.tip`) : null;

  return (
    <article className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-8 pb-12">
      <header className="space-y-3">
        <p className="text-sm">
          <Link
            href={`/guides/discord-bot/${role}`}
            className="text-hq-accent hover:underline"
          >
            ← {t(`roles.${role}.title`)}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`steps.${messageKey}.title`)}
        </h1>
        <p className="text-sm leading-relaxed text-hq-fg-muted">
          {t(`steps.${messageKey}.summary`)}
        </p>
      </header>

      {stepSlug === "install-bot" ? (
        <Link
          href="/discord/setup"
          className="inline-flex w-full items-center justify-center rounded-lg border border-[#5865F2] bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 sm:w-auto"
        >
          {t("steps.installBot.wizardCta")}
        </Link>
      ) : null}

      {command ? (
        <div className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-subtle">
            {t("flow.commandLabel")}
          </p>
          <p className="mt-1 font-mono text-sm text-hq-fg">{command}</p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-medium">{t("flow.instructionsHeading")}</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-[#c9d1d9]">
          {t(`steps.${messageKey}.instructions`)}
        </p>
        {tip ? (
          <p className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3 text-sm leading-relaxed text-hq-fg-muted">
            {tip}
          </p>
        ) : null}
      </section>

      {def?.screenshotKey ? (
        <GuideScreenshotSlot
          src={DISCORD_BOT_GUIDE_SCREENSHOTS[def.screenshotKey] ?? null}
          alt={t(`screenshots.${def.screenshotKey}.alt`)}
          caption={t(`screenshots.${def.screenshotKey}.caption`)}
        />
      ) : null}

      {def?.troubleshootingIds && def.troubleshootingIds.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-medium">{t("troubleshooting.heading")}</h2>
          <div className="space-y-2">
            {def.troubleshootingIds.map((id) => (
              <details
                key={id}
                className="group rounded-lg border border-hq-border bg-hq-surface open:border-hq-accent/40"
              >
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-2">
                    {t(`troubleshooting.${id}.title`)}
                    <span className="text-xs text-hq-fg-subtle group-open:hidden">
                      {t("troubleshooting.expand")}
                    </span>
                  </span>
                </summary>
                <div className="space-y-3 border-t border-hq-border px-4 py-3">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-hq-fg-muted">
                    {t(`troubleshooting.${id}.body`)}
                  </p>
                  {id === "copyNameUid" ? (
                    <GuideScreenshotSlot
                      src={DISCORD_BOT_GUIDE_SCREENSHOTS.copyNameUid ?? null}
                      alt={t("screenshots.copyNameUid.alt")}
                      caption={t("screenshots.copyNameUid.caption")}
                    />
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <nav
        className="flex min-w-0 flex-col gap-3 border-t border-hq-border pt-6 sm:flex-row sm:justify-between"
        aria-label="Step navigation"
      >
        {prevSlug ? (
          <Link
            href={`/guides/discord-bot/${role}/${prevSlug}`}
            className="text-sm text-hq-accent hover:underline"
          >
            ← {t(`steps.${stepSlugToMessageKey(prevSlug)}.title`)}
          </Link>
        ) : (
          <span />
        )}
        {nextSlug ? (
          <Link
            href={`/guides/discord-bot/${role}/${nextSlug}`}
            className="text-sm text-hq-accent hover:underline sm:text-right"
          >
            {t(`steps.${stepSlugToMessageKey(nextSlug)}.title`)} →
          </Link>
        ) : (
          <Link
            href={`/guides/discord-bot/${role}`}
            className="text-sm text-hq-accent hover:underline sm:text-right"
          >
            {t("flow.backToFlow")}
          </Link>
        )}
      </nav>
    </article>
  );
}
