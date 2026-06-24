"use client";

import { useTranslations } from "next-intl";

import { AllianceSeasonSettings } from "@/components/settings/AllianceSeasonSettings";
import { Link } from "@/i18n/navigation";
import { allianceSettingsPath } from "@/lib/alliance/alliance-settings-path.shared";

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
        {!allianceTag && <p className="mt-1 text-sm text-[#8b949e]">{t("subtitleAlliance")}</p>}
      </div>

      {allianceTag ? (
        <>
          <AllianceSeasonSettings allianceTag={allianceTag} />
          <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
            <h2 className="font-medium">{t("allianceSettingsLinkTitle")}</h2>
            <p className="mt-2 text-sm text-[#8b949e]">
              {t("allianceSettingsLinkBody")}
            </p>
            <Link
              href={allianceSettingsPath(allianceTag)}
              className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
            >
              {t("allianceSettingsLinkCta")} →
            </Link>
          </section>
        </>
      ) : null}

      {showTeamLink ? (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="font-medium">{t("teamSectionTitle")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("teamSectionBody")}</p>
          <Link
            href="/settings/team"
            className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
          >
            {t("teamSectionLink")} →
          </Link>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("uploadRemindersTitle")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{t("uploadRemindersBody")}</p>
        <Link
          href="/settings/upload-reminders"
          className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {t("uploadRemindersLink")} →
        </Link>
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("accountSecurityTitle")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{t("accountSecurityBody")}</p>
        <Link
          href="/settings/account"
          className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {t("accountSecurityLink")} →
        </Link>
      </section>
    </div>
  );
}
