import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { Link } from "@/i18n/navigation";
import { requirePageSession } from "@/lib/session";
import { sessionIsPlatformMaintainer } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

const ADMIN_LINKS = [
  { href: "/admin", labelKey: "overview" as const },
  { href: "/admin/system", labelKey: "system" as const },
  { href: "/admin/alliances", labelKey: "alliances" as const },
  { href: "/admin/users", labelKey: "users" as const },
  { href: "/admin/audit", labelKey: "audit" as const },
  { href: "/admin/video-jobs", labelKey: "videoJobs" as const },
  { href: "/admin/hq-events", labelKey: "hqEvents" as const },
  { href: "/admin/commendations", labelKey: "commendations" as const },
  { href: "/admin/bug-reports", labelKey: "bugReports" as const },
  { href: "/admin/experience-feedback", labelKey: "experienceFeedback" as const },
  { href: "/admin/translation-reports", labelKey: "translationReports" as const },
];

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requirePageSession("/admin");
  const allowed = await sessionIsPlatformMaintainer(session.id);
  if (!allowed) {
    redirect({ href: "/dashboard", locale });
  }

  const t = await getTranslations("admin");

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-[#30363d] pb-4">
        {ADMIN_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg px-3 py-1.5 text-sm text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
          >
            {t(`nav.${link.labelKey}`)}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
