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
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <div className="mb-5 flex items-center gap-4">
          <ProfileAvatar
            displayName={displayName}
            email={email}
            avatarUrl={avatarUrl}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-medium text-[#e6edf3]">
              {displayName}
            </p>
            <p className="truncate text-sm text-[#8b949e]">{email}</p>
          </div>
        </div>

        <dl className="space-y-4 border-t border-[#30363d] pt-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("displayName")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">{displayName}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("email")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">{email}</dd>
          </div>
          {allianceTag && roleName ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
                {t("allianceRole")}
              </dt>
              <dd className="mt-1 text-sm text-[#e6edf3]">
                {t("allianceRoleValue", { tag: allianceTag, role: roleName })}
              </dd>
            </div>
          ) : allianceTag ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
                {t("allianceRole")}
              </dt>
              <dd className="mt-1 text-sm text-[#e6edf3]">{allianceTag}</dd>
            </div>
          ) : null}
          {isMaintainer ? (
            <div>
              <span className="inline-flex rounded-full border border-[#388bfd]/40 bg-[#388bfd]/10 px-2.5 py-0.5 text-xs font-medium text-[#58a6ff]">
                {t("maintainerBadge")}
              </span>
            </div>
          ) : null}
        </dl>
      </section>

      <Link
        href="/account"
        className="inline-flex items-center text-sm text-[#58a6ff] hover:underline"
      >
        {t("accountSettingsLink")} →
      </Link>
    </div>
  );
}
