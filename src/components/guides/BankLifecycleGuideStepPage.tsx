"use client";

import { useTranslations } from "next-intl";

import { GuideScreenshotSlot } from "@/components/guides/GuideScreenshotSlot";
import { Link } from "@/i18n/navigation";
import {
  BANK_LIFECYCLE_GUIDE_SCREENSHOTS,
  BANK_LIFECYCLE_GUIDE_STEPS,
  BANK_LIFECYCLE_GUIDE_STEP_SLUGS,
  stepSlugToMessageKey,
  type BankLifecycleGuideStepSlug,
} from "@/lib/guides/bank-lifecycle-guide.shared";

type Props = {
  stepSlug: BankLifecycleGuideStepSlug;
};

export function BankLifecycleGuideStepPage({ stepSlug }: Props) {
  const t = useTranslations("guides.bankLifecycle");
  const messageKey = stepSlugToMessageKey(stepSlug);
  const def = BANK_LIFECYCLE_GUIDE_STEPS[stepSlug];
  const steps = BANK_LIFECYCLE_GUIDE_STEP_SLUGS;
  const stepIndex = steps.indexOf(stepSlug);
  const prevSlug = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextSlug =
    stepIndex >= 0 && stepIndex < steps.length - 1
      ? steps[stepIndex + 1]
      : null;

  const tip = def?.showTip ? t(`steps.${messageKey}.tip`) : null;

  return (
    <article className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-8 pb-12">
      <header className="space-y-3">
        <p className="text-sm">
          <Link
            href="/guides/bank-lifecycle"
            className="text-hq-accent hover:underline"
          >
            ← {t("hub.title")}
          </Link>
        </p>
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-subtle">
          {t("flow.stepLabel", { current: stepIndex + 1, total: steps.length })}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`steps.${messageKey}.title`)}
        </h1>
        <p className="text-sm leading-relaxed text-hq-fg-muted">
          {t(`steps.${messageKey}.summary`)}
        </p>
      </header>

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

      {def?.screenshotKeys?.length ? (
        <section className="space-y-2">
          {def.screenshotKeys.map((key) => (
            <GuideScreenshotSlot
              key={key}
              src={BANK_LIFECYCLE_GUIDE_SCREENSHOTS[key] ?? null}
              alt={t(`screenshots.${key}.alt`)}
              caption={t(`screenshots.${key}.caption`)}
            />
          ))}
        </section>
      ) : null}

      <nav
        className="flex min-w-0 flex-col gap-3 border-t border-hq-border pt-6 sm:flex-row sm:justify-between"
        aria-label="Step navigation"
      >
        {prevSlug ? (
          <Link
            href={`/guides/bank-lifecycle/${prevSlug}`}
            className="text-sm text-hq-accent hover:underline"
          >
            ← {t(`steps.${stepSlugToMessageKey(prevSlug)}.title`)}
          </Link>
        ) : (
          <span />
        )}
        {nextSlug ? (
          <Link
            href={`/guides/bank-lifecycle/${nextSlug}`}
            className="text-sm text-hq-accent hover:underline sm:text-right"
          >
            {t(`steps.${stepSlugToMessageKey(nextSlug)}.title`)} →
          </Link>
        ) : (
          <Link
            href="/guides/bank-lifecycle"
            className="text-sm text-hq-accent hover:underline sm:text-right"
          >
            {t("flow.backToFlow")}
          </Link>
        )}
      </nav>
    </article>
  );
}
