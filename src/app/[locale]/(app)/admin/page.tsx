import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  ADMIN_OVERVIEW_CARDS,
  AdminOverviewCardIcon,
} from "@/lib/admin/overview-cards";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {ADMIN_OVERVIEW_CARDS.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 transition-colors hover:border-[#58a6ff]"
        >
          <div className="flex items-start gap-3">
            <AdminOverviewCardIcon icon={card.icon} />
            <div className="min-w-0">
              <h2 className="font-medium">{t(card.titleKey)}</h2>
              <p className="mt-2 text-sm text-[#8b949e]">{t(card.descKey)}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
