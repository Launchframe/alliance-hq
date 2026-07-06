import { getTranslations } from "next-intl/server";

import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Link } from "@/i18n/navigation";
import { getRbacContext } from "@/lib/rbac/context";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requirePageSession("/profile");
  const rbac = await getRbacContext(session.id);
  const t = await getTranslations("profile");

  const displayName =
    rbac?.displayName ?? session.userLabel ?? t("unknownUser");
  const email = rbac?.email ?? t("unknownEmail");
  const avatarUrl = rbac?.avatarUrl ?? null;
  const allianceTag = session.allianceTag;
  const roleName = rbac?.roleName;
  const isMaintainer = rbac?.isPlatformMaintainer ?? false;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <div className="mb-5 flex items-center gap-4">
          <ProfileAvatar
            displayName={displayName}
            email={email}
            avatarUrl={avatarUrl}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-medium text-hq-fg">
              {displayName}
            </p>
            <p className="truncate text-sm text-hq-fg-muted">{email}</p>
          </div>
        </div>

        <dl className="space-y-4 border-t border-hq-border pt-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("displayName")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">{displayName}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("email")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">{email}</dd>
          </div>
          {allianceTag && roleName ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
                {t("allianceRole")}
              </dt>
              <dd className="mt-1 text-sm text-hq-fg">
                {t("allianceRoleValue", { tag: allianceTag, role: roleName })}
              </dd>
            </div>
          ) : allianceTag ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
                {t("allianceRole")}
              </dt>
              <dd className="mt-1 text-sm text-hq-fg">{allianceTag}</dd>
            </div>
          ) : null}
          {isMaintainer ? (
            <div>
              <span className="inline-flex rounded-full border border-[#388bfd]/40 bg-[#388bfd]/10 px-2.5 py-0.5 text-xs font-medium text-hq-accent">
                {t("maintainerBadge")}
              </span>
            </div>
          ) : null}
        </dl>
      </section>

      <Link
        href="/account"
        className="inline-flex items-center text-sm text-hq-accent hover:underline"
      >
        {t("accountSettingsLink")} →
      </Link>
    </div>
  );
}
