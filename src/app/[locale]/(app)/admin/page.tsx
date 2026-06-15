import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");

  const cards = [
    { href: "/admin/system", titleKey: "systemTitle", descKey: "systemDesc" },
    { href: "/admin/alliances", titleKey: "alliancesTitle", descKey: "alliancesDesc" },
    { href: "/admin/users", titleKey: "usersTitle", descKey: "usersDesc" },
    { href: "/admin/audit", titleKey: "auditTitle", descKey: "auditDesc" },
    {
      href: "/admin/video-jobs",
      titleKey: "videoJobsTitle",
      descKey: "videoJobsDesc",
    },
    {
      href: "/admin/hq-events",
      titleKey: "hqEventsTitle",
      descKey: "hqEventsDesc",
    },
    {
      href: "/admin/commendations",
      titleKey: "commendationsTitle",
      descKey: "commendationsDesc",
    },
    {
      href: "/admin/bug-reports",
      titleKey: "bugReportsTitle",
      descKey: "bugReportsDesc",
    },
    {
      href: "/admin/experience-feedback",
      titleKey: "experienceFeedbackTitle",
      descKey: "experienceFeedbackDesc",
    },
    {
      href: "/admin/translation-reports",
      titleKey: "translationReportsTitle",
      descKey: "translationReportsDesc",
    },
  ] as const;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 hover:border-[#58a6ff]"
        >
          <h2 className="font-medium">{t(card.titleKey)}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t(card.descKey)}</p>
        </Link>
      ))}
    </div>
  );
}
