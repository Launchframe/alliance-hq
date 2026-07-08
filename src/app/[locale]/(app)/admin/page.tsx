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
          className="rounded-xl border border-hq-border bg-hq-surface p-5 transition-colors hover:border-hq-accent"
        >
          <div className="flex items-start gap-3">
            <AdminOverviewCardIcon icon={card.icon} />
            <div className="min-w-0">
              <h2 className="font-medium">{t(card.titleKey)}</h2>
              <p className="mt-2 text-sm text-hq-fg-muted">{t(card.descKey)}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
