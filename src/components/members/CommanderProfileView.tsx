"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import {
  MemberCommendationCards,
  MemberViolationCards,
} from "@/components/members/MemberDisciplineCards";
import { Link } from "@/i18n/navigation";
import type { CommanderProfilePayload } from "@/lib/members/commander-profile.shared";
import {
  membersListHrefFromFilters,
  readStoredMembersListFilters,
} from "@/lib/members/members-list-filters.shared";
import {
  MAIN_SQUAD_TYPES,
  MAIN_SQUAD_LABEL_KEYS,
  type MainSquadType,
} from "@/lib/commanders/main-squad.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";

type Props = {
  initial: CommanderProfilePayload;
};

function formatPowerM(value: number | null): string {
  if (value == null || value <= 0) return "—";
  return `${value.toFixed(1)}M`;
}

export function CommanderProfileView({ initial }: Props) {
  const t = useTranslations("members.profile");
  const tInvites = useTranslations("team.invites");
  const { member, alliance } = initial;
  const membersListHref = useSyncExternalStore(
    () => () => {},
    () => membersListHrefFromFilters(readStoredMembersListFilters()),
    () => "/members",
  );

  const [squadValue, setSquadValue] = useState<MainSquadType | "">(member.mainSquad ?? "");
  const [squadSaving, setSquadSaving] = useState(false);
  const [squadMessage, setSquadMessage] = useState<string | null>(null);

  const [hqUnlinked, setHqUnlinked] = useState(false);
  const [discordUnlinked, setDiscordUnlinked] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState<"hq" | "discord" | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<"hq" | "discord" | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  async function unlink(target: "hq" | "discord") {
    setUnlinkBusy(target);
    setUnlinkError(null);
    try {
      const res = await fetch("/api/settings/team/commander-links/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashedMemberId: member.ashedMemberId, target }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setUnlinkError(body.error ?? t("unlinkFailed"));
        return;
      }
      if (target === "hq") {
        setHqUnlinked(true);
      } else {
        setDiscordUnlinked(true);
      }
      setUnlinkConfirm(null);
    } catch (e) {
      setUnlinkError(e instanceof Error ? e.message : t("unlinkFailed"));
    } finally {
      setUnlinkBusy(null);
    }
  }

  async function saveSquad() {
    if (!squadValue) return;
    setSquadSaving(true);
    setSquadMessage(null);
    try {
      const method =
        member.viewerIsOwner && !member.canOfficerOverrideMainSquad
          ? "POST"
          : "PATCH";
      const res = await fetch(`/api/members/${member.ashedMemberId}/main-squad`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainSquad: squadValue }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSquadMessage(body.error ?? t("mainSquadSaveFailed"));
        return;
      }
      setSquadMessage(t("mainSquadSaved"));
    } catch (e) {
      setSquadMessage(e instanceof Error ? e.message : t("mainSquadSaveFailed"));
    } finally {
      setSquadSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{member.currentName}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">
            {t("allianceContext", {
              tag: alliance.tag ?? alliance.slug,
            })}
          </p>
        </div>
        <Link
          href={membersListHref}
          className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-[#c9d1d9] hover:bg-hq-surface"
        >
          {t("backToMembers")}
        </Link>
      </div>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <div className="mb-5 flex items-center gap-4">
          <ProfileAvatar
            displayName={member.currentName}
            email={member.gameUid ?? member.ashedMemberId}
            avatarUrl={null}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-medium text-hq-fg">
              {member.currentName}
            </p>
            <p className="truncate text-sm text-hq-fg-muted">
              {member.gameUid
                ? t("gameUid", { uid: member.gameUid })
                : t("allianceContext", { tag: alliance.tag ?? alliance.slug })}
            </p>
          </div>
        </div>

        <dl className="grid gap-4 border-t border-hq-border pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("rank")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">{member.rankLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("title")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">{member.titleLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("status")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">{member.status}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("heroPower")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">
              {formatPowerM(member.heroPowerM)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("level")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">
              {member.memberLevel ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
              {t("mainSquad")}
            </dt>
            <dd className="mt-1 text-sm text-hq-fg">
              {member.mainSquad
                ? t(`squad.${MAIN_SQUAD_LABEL_KEYS[member.mainSquad]}`)
                : <span className="text-[#484f58]">{t("mainSquadNone")}</span>}
              {member.mainSquadSource ? (
                <span className="ml-2 text-xs text-hq-fg-muted">
                  {t("mainSquadSource", {
                    source:
                      member.mainSquadSource === "officer_override"
                        ? t("mainSquadSourceOfficer")
                        : t("mainSquadSourceSelf"),
                  })}
                </span>
              ) : null}
            </dd>
          </div>
          {member.previousNames.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wider text-hq-fg-subtle">
                {t("previousNames")}
              </dt>
              <dd className="mt-1 text-sm text-hq-fg">
                {member.previousNames.join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {member.canEditMainSquad ? (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-hq-fg-muted">
            {t("mainSquad")}
          </h2>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              preventDefaultFormSubmit(e);
              void saveSquad();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
              {t("mainSquad")}
              <select
                value={squadValue}
                onChange={(e) => {
                  setSquadValue(e.target.value as MainSquadType | "");
                  setSquadMessage(null);
                }}
                disabled={squadSaving}
                className="rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-sm text-hq-fg disabled:opacity-50"
              >
                <option value="">{t("mainSquadNone")}</option>
                {MAIN_SQUAD_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`squad.${MAIN_SQUAD_LABEL_KEYS[s]}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={squadSaving || !squadValue}
              className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {squadSaving ? t("mainSquadSaving") : t("mainSquadSaveLabel")}
            </button>
          </form>
          {squadMessage ? (
            <p className="mt-3 text-sm text-hq-fg-muted">{squadMessage}</p>
          ) : null}
        </section>
      ) : null}

      {(initial.hqUser || initial.discordLinks.length > 0) && (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-hq-fg-muted">
            {t("identityLinks")}
          </h2>
          <dl className="mt-4 space-y-3">
            {initial.hqUser && !hqUnlinked ? (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <dt className="text-xs text-hq-fg-subtle">{t("hqUser")}</dt>
                  <dd className="text-sm text-hq-fg">
                    {initial.hqUser.displayName ?? initial.hqUser.id}
                    {initial.hqUser.email ? ` · ${initial.hqUser.email}` : ""}
                  </dd>
                </div>
                {initial.member.viewerCanBreakGlassUnlink ? (
                  unlinkConfirm === "hq" ? (
                    <div className="max-w-sm space-y-2 rounded-lg border border-hq-danger/40 bg-hq-danger/5 p-3">
                      <div>
                        <p className="text-xs font-medium text-hq-danger">
                          {t("unlinkConfirmQuestion")}
                        </p>
                        <p className="mt-1 text-xs text-hq-fg-muted">
                          {t("unlinkHqConfirmDescription")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={unlinkBusy === "hq"}
                          onClick={() => void unlink("hq")}
                          className="rounded-lg border border-hq-danger bg-hq-danger/10 px-2.5 py-1 text-xs text-hq-danger disabled:opacity-50"
                        >
                          {unlinkBusy === "hq" ? t("unlinkBusy") : t("unlinkConfirm")}
                        </button>
                        <button
                          type="button"
                          disabled={unlinkBusy === "hq"}
                          onClick={() => setUnlinkConfirm(null)}
                          className="rounded-lg border border-hq-border px-2.5 py-1 text-xs text-[#c9d1d9] disabled:opacity-50"
                        >
                          {t("unlinkCancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setUnlinkError(null);
                        setUnlinkConfirm("hq");
                      }}
                      className="shrink-0 rounded-lg border border-hq-border px-2.5 py-1 text-xs text-hq-fg-muted hover:text-hq-danger"
                    >
                      {t("unlinkHqButton")}
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
            {!discordUnlinked &&
              initial.discordLinks.map((link, index) => (
                <div
                  key={link.discordUserId}
                  className="flex flex-wrap items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <dt className="text-xs text-hq-fg-subtle">{t("discord")}</dt>
                    <dd className="text-sm text-hq-fg">
                      {link.discordUsername?.trim() ||
                        t("discordUserFallback", {
                          idSuffix: link.discordUserId.slice(-4),
                        })}
                    </dd>
                  </div>
                  {index === 0 && initial.member.viewerCanBreakGlassUnlink ? (
                    unlinkConfirm === "discord" ? (
                      <div className="max-w-sm space-y-2 rounded-lg border border-hq-danger/40 bg-hq-danger/5 p-3">
                        <div>
                          <p className="text-xs font-medium text-hq-danger">
                            {t("unlinkConfirmQuestion")}
                          </p>
                          <p className="mt-1 text-xs text-hq-fg-muted">
                            {t("unlinkDiscordConfirmDescription")}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={unlinkBusy === "discord"}
                            onClick={() => void unlink("discord")}
                            className="rounded-lg border border-hq-danger bg-hq-danger/10 px-2.5 py-1 text-xs text-hq-danger disabled:opacity-50"
                          >
                            {unlinkBusy === "discord"
                              ? t("unlinkBusy")
                              : t("unlinkConfirm")}
                          </button>
                          <button
                            type="button"
                            disabled={unlinkBusy === "discord"}
                            onClick={() => setUnlinkConfirm(null)}
                            className="rounded-lg border border-hq-border px-2.5 py-1 text-xs text-[#c9d1d9] disabled:opacity-50"
                          >
                            {t("unlinkCancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUnlinkError(null);
                          setUnlinkConfirm("discord");
                        }}
                        className="shrink-0 rounded-lg border border-hq-border px-2.5 py-1 text-xs text-hq-fg-muted hover:text-hq-danger"
                      >
                        {t("unlinkDiscordButton")}
                      </button>
                    )
                  ) : null}
                </div>
              ))}
            {hqUnlinked || discordUnlinked ? (
              <p className="text-sm text-hq-green" role="status">
                {t("unlinkSuccess")}
              </p>
            ) : null}
            {unlinkError ? (
              <p className="text-sm text-hq-danger" role="alert">
                {unlinkError}
              </p>
            ) : null}
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
            {initial.eventScores.map((row) => (
              <li key={`${row.eventId}-${row.updatedAt}`} className="text-[#c9d1d9]">
                {row.eventName}
                {row.score != null ? ` · ${row.score.toLocaleString()}` : ""}
                {row.rank != null ? ` · #${row.rank}` : ""}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {initial.commendations.length > 0 ? (
        <ProfileSection title={t("commendations")}>
          <MemberCommendationCards rows={initial.commendations} />
        </ProfileSection>
      ) : null}

      {initial.violations.length > 0 ? (
        <ProfileSection title={t("violations")}>
          <MemberViolationCards rows={initial.violations} />
        </ProfileSection>
      ) : null}

      {initial.hqUser === null && initial.member.viewerCanIssueClaimInvite && (
        <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-hq-fg-muted">
              {tInvites("claimRowAction")}
            </h2>
            <span className="rounded-full border border-[#e3b341]/40 bg-[#e3b341]/10 px-2 py-0.5 text-xs font-medium text-[#e3b341]">
              {tInvites("wizard.badgeDmOnly")}
            </span>
          </div>
          <p className="mt-2 text-sm text-hq-fg-muted">{tInvites("wizard.typeClaimBody")}</p>
          <Link
            href={`/settings/team?inviteWizard=claim&commander=${encodeURIComponent(member.ashedMemberId)}`}
            className="mt-3 inline-flex rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-hq-accent hover:bg-[#388bfd]/20"
          >
            {tInvites("wizard.openClaimWizard")}
          </Link>
        </section>
      )}

      {initial.trainHighlights.length > 0 && (
        <ProfileSection title={t("trainHighlights")}>
          <ul className="space-y-2 text-sm">
            {initial.trainHighlights.map((row) => (
              <li
                key={`${row.date}-${row.role}-${row.lockedAt ?? "pending"}`}
                className="text-[#c9d1d9]"
              >
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
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-hq-fg-muted">
        {title}
      </h2>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}
