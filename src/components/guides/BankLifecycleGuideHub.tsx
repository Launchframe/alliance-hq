"use client";

import { useTranslations } from "next-intl";

import { BankLifecycleGuideFlowchart } from "@/components/guides/BankLifecycleGuideFlowchart";
import { GuideScreenshotSlot } from "@/components/guides/GuideScreenshotSlot";
import { Link } from "@/i18n/navigation";
import { BANK_LIFECYCLE_GUIDE_STEP_SLUGS } from "@/lib/guides/bank-lifecycle-guide.shared";

export function BankLifecycleGuideHub() {
  const t = useTranslations("guides.bankLifecycle");

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-10 pb-12">
      <header className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("hub.title")}
        </h1>
        <p className="text-sm leading-relaxed text-hq-fg-muted sm:text-base">
          {t("hub.subtitle")}
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-5 sm:p-6">
        <h2 className="text-lg font-medium">{t("hub.funnelTitle")}</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-hq-fg-muted">
          {t("hub.funnelBody")}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("hub.videoTitle")}</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-hq-fg-muted">
          {t("hub.videoBody")}
        </p>
        <GuideScreenshotSlot
          alt={t("screenshots.bankInfoMenu.alt")}
          caption={t("screenshots.bankInfoMenu.caption")}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">{t("hub.flowTitle")}</h2>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("hub.flowBody")}</p>
        </div>
        <BankLifecycleGuideFlowchart />
      </section>

      <section className="rounded-xl border border-hq-accent/30 bg-hq-accent/10 p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-hq-fg">
          {t.rich("hub.startCallout", {
            link: (chunks) => (
              <Link
                href={`/guides/bank-lifecycle/${BANK_LIFECYCLE_GUIDE_STEP_SLUGS[0]}`}
                className="text-hq-accent hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>
    </div>
  );
}
