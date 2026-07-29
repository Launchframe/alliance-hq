"use client";

import { useTranslations } from "next-intl";

type Props = {
  onOpenSettings?: () => void;
};

export function AllianceSafeTimeSetupBanner({ onOpenSettings }: Props) {
  const t = useTranslations("allianceSafeTime");

  return (
    <section
      className="rounded-xl border border-hq-accent/35 bg-hq-accent/10 px-4 py-3"
      data-testid="alliance-safe-time-setup-banner"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-hq-fg">{t("setupBannerTitle")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-hq-fg-muted">
            {t("setupBannerBody")}
          </p>
        </div>
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-lg border border-hq-accent bg-hq-canvas px-4 py-2 text-sm font-medium text-hq-fg hover:border-hq-accent/80"
          >
            {t("setupBannerCta")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
