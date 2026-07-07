"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Props = {
  allianceTag: string;
  installConfigured: boolean;
  registeredGuildCount: number;
  canManage: boolean;
};

export function AllianceDiscordServerSetup({
  allianceTag,
  installConfigured,
  registeredGuildCount,
  canManage,
}: Props) {
  const t = useTranslations("settings.discordServerSetup");

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-hq-fg-muted">{t("body")}</p>

      {registeredGuildCount > 0 ? (
        <p className="mt-3 text-sm text-hq-green">
          {t("registeredCount", { count: registeredGuildCount })}
        </p>
      ) : (
        <p className="mt-3 text-sm text-hq-fg-muted">{t("noneRegistered")}</p>
      )}

      {canManage ? (
        <div className="mt-4 space-y-3">
          {installConfigured ? (
            <Link
              href={`/discord/setup?tag=${encodeURIComponent(allianceTag)}`}
              className="inline-flex rounded-lg border border-hq-discord bg-hq-discord px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {t("installButton")}
            </Link>
          ) : (
            <p className="text-sm text-hq-danger">{t("installUnavailable")}</p>
          )}

          <div className="rounded-lg border border-hq-border bg-hq-canvas px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-subtle">
              {t("nextStepsLabel")}
            </p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-hq-fg">
              {t("nextStepsBody", { tag: allianceTag })}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("readOnlyHint")}</p>
      )}

      <Link
        href="/guides/getting-started"
        className="mt-4 inline-block text-sm text-hq-accent hover:underline"
      >
        {t("gettingStartedLink")} →
      </Link>

      <Link
        href="/guides/discord-bot/r5/install-bot"
        className="mt-2 inline-block text-sm text-hq-accent hover:underline"
      >
        {t("guideLink")} →
      </Link>
    </section>
  );
}
