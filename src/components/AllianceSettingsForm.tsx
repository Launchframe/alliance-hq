"use client";

import { useTranslations } from "next-intl";

import { AllianceSeasonSettings } from "@/components/settings/AllianceSeasonSettings";
import { Link } from "@/i18n/navigation";

type Props = {
  allianceTag: string | null;
  showTeamLink?: boolean;
};

export function AllianceSettingsForm({
  allianceTag,
  showTeamLink = true,
}: Props) {
  const t = useTranslations("settings");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {allianceTag
            ? t("titleWithTag", { tag: allianceTag })
            : t("titleAlliance")}
        </h1>
        {!allianceTag && <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitleAlliance")}</p>}
      </div>

      {allianceTag ? (
        <>
          <AllianceSeasonSettings allianceTag={allianceTag} />
          <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
            <h2 className="font-medium">{t("discordSectionTitle")}</h2>
            <p className="mt-2 text-sm text-hq-fg-muted">{t("discordSectionBody")}</p>
            <Link
              href="/settings/discord"
              className="mt-4 inline-block text-sm text-hq-accent hover:underline"
            >
              {t("discordSectionLink")} →
            </Link>
          </section>
          <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
            <h2 className="font-medium">{t("trainsSectionTitle")}</h2>
            <p className="mt-2 text-sm text-hq-fg-muted">{t("trainsSectionBody")}</p>
            <Link
              href="/settings/trains"
              className="mt-4 inline-block text-sm text-hq-accent hover:underline"
            >
              {t("trainsSectionLink")} →
            </Link>
          </section>
        </>
      ) : null}

      {showTeamLink ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <h2 className="font-medium">{t("teamSectionTitle")}</h2>
          <p className="mt-2 text-sm text-hq-fg-muted">{t("teamSectionBody")}</p>
          <Link
            href="/settings/team"
            className="mt-4 inline-block text-sm text-hq-accent hover:underline"
          >
            {t("teamSectionLink")} →
          </Link>
        </section>
      ) : null}

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("uploadRemindersTitle")}</h2>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("uploadRemindersBody")}</p>
        <Link
          href="/settings/upload-reminders"
          className="mt-4 inline-block text-sm text-hq-accent hover:underline"
        >
          {t("uploadRemindersLink")} →
        </Link>
      </section>
    </div>
  );
}
