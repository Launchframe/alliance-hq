"use client";

import { ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  BANK_LIFECYCLE_GUIDE_STEP_SLUGS,
  stepSlugToMessageKey,
} from "@/lib/guides/bank-lifecycle-guide.shared";

export function BankLifecycleGuideFlowchart() {
  const t = useTranslations("guides.bankLifecycle");
  const steps = BANK_LIFECYCLE_GUIDE_STEP_SLUGS;

  return (
    <ol className="flex min-w-0 flex-col items-stretch gap-0">
      {steps.map((stepSlug, index) => {
        const messageKey = stepSlugToMessageKey(stepSlug);
        const isLast = index === steps.length - 1;

        return (
          <li key={stepSlug} className="flex min-w-0 flex-col items-stretch">
            <Link
              href={`/guides/bank-lifecycle/${stepSlug}`}
              className="group block min-w-0 rounded-xl border border-hq-border bg-hq-surface px-4 py-4 transition-colors hover:border-hq-accent/60 hover:bg-hq-surface-muted"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hq-surface-muted text-xs font-semibold text-hq-accent"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug group-hover:text-hq-accent">
                    {t(`steps.${messageKey}.title`)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-hq-fg-muted">
                    {t(`steps.${messageKey}.summary`)}
                  </p>
                </div>
              </div>
            </Link>
            {!isLast ? (
              <div className="flex justify-center py-1 text-hq-border" aria-hidden>
                <ArrowDown className="h-5 w-5" />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
