import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ashedLink } from "@/components/i18n/richText";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/tools/video-upload"
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 hover:border-[#58a6ff]"
        >
          <h2 className="font-medium">{t("videoCardTitle")}</h2>
          <p className="mt-1 text-sm text-[#8b949e]">
            {t("videoCardDescription")}
          </p>
        </Link>

        <a
          href="https://ashed.online/reports"
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 hover:border-[#58a6ff]"
        >
          <h2 className="font-medium">{t("reportsCardTitle")}</h2>
          <p className="mt-1 text-sm text-[#8b949e]">
            {t("reportsCardDescription")}
          </p>
        </a>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-sm font-medium text-[#8b949e]">{t("aboutTitle")}</h2>
        <p className="mt-2 text-sm">
          {t.rich("aboutBody", { link: ashedLink })}
        </p>
      </section>
    </div>
  );
}
