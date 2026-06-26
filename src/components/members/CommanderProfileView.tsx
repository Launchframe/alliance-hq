"use client";

import { useTranslations } from "next-intl";

import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Link } from "@/i18n/navigation";
import type { CommanderProfilePayload } from "@/lib/members/commander-profile.shared";

type Props = {
  initial: CommanderProfilePayload;
};

function formatPowerM(value: number | null): string {
  if (value == null || value <= 0) return "—";
  return `${value.toFixed(1)}M`;
}

export function CommanderProfileView({ initial }: Props) {
  const t = useTranslations("members.profile");
  const { member, alliance } = initial;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{member.currentName}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">
            {t("allianceContext", {
              tag: alliance.tag ?? alliance.slug,
            })}
          </p>
        </div>
        <Link
          href="/members"
          className="rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-[#c9d1d9] hover:bg-[#161b22]"
        >
          {t("backToMembers")}
        </Link>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <div className="mb-5 flex items-center gap-4">
          <ProfileAvatar
            displayName={member.currentName}
            email={member.gameUid ?? member.ashedMemberId}
            avatarUrl={null}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-medium text-[#e6edf3]">
              {member.currentName}
            </p>
            <p className="truncate text-sm text-[#8b949e]">
              {member.gameUid
                ? t("gameUid", { uid: member.gameUid })
                : t("allianceContext", { tag: alliance.tag ?? alliance.slug })}
            </p>
          </div>
        </div>

        <dl className="grid gap-4 border-t border-[#30363d] pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("rank")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">{member.rankLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("title")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">{member.titleLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("status")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">{member.status}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("heroPower")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">
              {formatPowerM(member.heroPowerM)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
              {t("level")}
            </dt>
            <dd className="mt-1 text-sm text-[#e6edf3]">
              {member.memberLevel ?? "—"}
            </dd>
          </div>
          {member.previousNames.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wider text-[#6e7681]">
                {t("previousNames")}
              </dt>
              <dd className="mt-1 text-sm text-[#e6edf3]">
                {member.previousNames.join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {(initial.hqUser || initial.discordLinks.length > 0) && (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#8b949e]">
            {t("identityLinks")}
          </h2>
          <dl className="mt-4 space-y-3">
            {initial.hqUser ? (
              <div>
                <dt className="text-xs text-[#6e7681]">{t("hqUser")}</dt>
                <dd className="text-sm text-[#e6edf3]">
                  {initial.hqUser.displayName ?? initial.hqUser.id}
                  {initial.hqUser.email ? ` · ${initial.hqUser.email}` : ""}
                </dd>
              </div>
            ) : null}
            {initial.discordLinks.map((link) => (
              <div key={link.discordUserId}>
                <dt className="text-xs text-[#6e7681]">{t("discord")}</dt>
                <dd className="text-sm text-[#e6edf3]">
                  {link.discordUsername ?? link.discordUserId}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {initial.tenureHistory.length > 0 && (
        <ProfileSection title={t("tenureHistory")}>
          <ul className="space-y-2 text-sm">
            {initial.tenureHistory.map((row) => (
              <li key={`${row.allianceId}-${row.joinedAt}`} className="text-[#c9d1d9]">
                <span className="font-medium">
                  {row.allianceTag ?? row.allianceName ?? row.allianceId}
                </span>
                {" · "}
                {new Date(row.joinedAt).toLocaleDateString()}
                {row.leftAt
                  ? ` – ${new Date(row.leftAt).toLocaleDateString()}`
                  : ` · ${t("current")}`}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {initial.rankTimeline.length > 0 && (
        <ProfileSection title={t("rankTimeline")}>
          <ul className="space-y-2 text-sm">
            {initial.rankTimeline.map((row) => (
              <li key={row.id} className="text-[#c9d1d9]">
                R{row.allianceRank}
                {row.allianceRankTitle ? ` (${row.allianceRankTitle})` : ""}
                {" · "}
                {row.effectiveDate}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {initial.vrHistory.length > 0 && (
        <ProfileSection title={t("vrHistory")}>
          <ul className="space-y-2 text-sm">
            {initial.vrHistory.map((row) => (
              <li key={row.seasonKey} className="text-[#c9d1d9]">
                {t("vrSeasonLine", {
                  season: row.seasonKey,
                  vr: row.highestBaseVr.toLocaleString(),
                })}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {initial.eventScores.length > 0 && (
        <ProfileSection title={t("eventScores")}>
          <ul className="space-y-2 text-sm">
            {initial.eventScores.map((row, index) => (
              <li key={`${row.eventId}-${index}`} className="text-[#c9d1d9]">
                {row.eventName}
                {row.score != null ? ` · ${row.score.toLocaleString()}` : ""}
                {row.rank != null ? ` · #${row.rank}` : ""}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {initial.commendations.length > 0 && (
        <ProfileSection title={t("commendations")}>
          <pre className="overflow-x-auto text-xs text-[#8b949e]">
            {JSON.stringify(initial.commendations, null, 2)}
          </pre>
        </ProfileSection>
      )}

      {initial.violations.length > 0 && (
        <ProfileSection title={t("violations")}>
          <pre className="overflow-x-auto text-xs text-[#8b949e]">
            {JSON.stringify(initial.violations, null, 2)}
          </pre>
        </ProfileSection>
      )}

      {initial.trainHighlights.length > 0 && (
        <ProfileSection title={t("trainHighlights")}>
          <ul className="space-y-2 text-sm">
            {initial.trainHighlights.map((row, index) => (
              <li key={`${row.date}-${row.role}-${index}`} className="text-[#c9d1d9]">
                {row.date} · {t(`trainRole.${row.role}`)}
                {row.lockedAt ? ` · ${t("locked")}` : ""}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}
    </div>
  );
}

function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#8b949e]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
