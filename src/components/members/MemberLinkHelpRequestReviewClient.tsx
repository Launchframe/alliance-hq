"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import type {
  HelpRequestRosterRow,
  MemberLinkHelpRequestReview,
} from "@/lib/member-link/member-link-help-review.shared";

type ReviewPayload = Omit<MemberLinkHelpRequestReview, "request"> & {
  request: Omit<MemberLinkHelpRequestReview["request"], "createdAt"> & {
    createdAt: string;
  };
};

type Props = {
  initialReview: ReviewPayload;
  linkUrlPrefix: string;
  resolveUrlPrefix: string;
  backHref: string;
  backLabel: string;
  showAlliance?: boolean;
};

function ContactBlock({
  title,
  name,
  email,
  discord,
  emptyLabel,
}: {
  title: string;
  name: string | null;
  email: string | null;
  discord: string | null;
  emptyLabel: string;
}) {
  const t = useTranslations("memberLinkHelpReview");
  const hasAny = Boolean(name || email || discord);
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-[#58a6ff]">
        {title}
      </p>
      {!hasAny ? (
        <p className="mt-2 text-sm text-[#8b949e]">{emptyLabel}</p>
      ) : (
        <dl className="mt-2 space-y-1 text-sm min-w-0">
          {name ? (
            <div className="min-w-0">
              <dt className="text-[#8b949e]">{t("contact.inGameName")}</dt>
              <dd className="break-words">{name}</dd>
            </div>
          ) : null}
          {email ? (
            <div className="min-w-0">
              <dt className="text-[#8b949e]">{t("contact.email")}</dt>
              <dd className="break-all">{email}</dd>
            </div>
          ) : null}
          {discord ? (
            <div className="min-w-0">
              <dt className="text-[#8b949e]">{t("contact.discord")}</dt>
              <dd className="break-all">{discord}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </div>
  );
}

function claimContactName(claim: HelpRequestRosterRow["claim"]): string | null {
  if (!claim) return null;
  return (
    claim.hq?.memberDisplayName ??
    claim.hq?.displayName ??
    claim.discord?.username ??
    null
  );
}

function claimContactEmail(claim: HelpRequestRosterRow["claim"]): string | null {
  return claim?.hq?.email ?? null;
}

function claimContactDiscord(
  claim: HelpRequestRosterRow["claim"],
): string | null {
  return claim?.discord?.username ?? null;
}

export function MemberLinkHelpRequestReviewClient({
  initialReview,
  linkUrlPrefix,
  resolveUrlPrefix,
  backHref,
  backLabel,
  showAlliance = false,
}: Props) {
  const t = useTranslations("memberLinkHelpReview");
  const router = useRouter();
  const [review] = useState(initialReview);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedUnclaimed = useMemo(
    () =>
      review.roster.unclaimed.find(
        (row) => row.ashedMemberId === selectedMemberId,
      ) ?? null,
    [review.roster.unclaimed, selectedMemberId],
  );

  const selectedClaimed = useMemo(
    () =>
      review.roster.claimed.find(
        (row) => row.ashedMemberId === selectedMemberId,
      ) ?? null,
    [review.roster.claimed, selectedMemberId],
  );

  const requesterName =
    review.request.reportedName ??
    review.request.gameUserName ??
    review.requester.requesterHandle;

  async function linkSelected() {
    if (!selectedUnclaimed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${linkUrlPrefix}/${review.request.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAshedMemberId: selectedUnclaimed.ashedMemberId,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        memberName?: string;
      } | null;
      if (!res.ok) {
        if (payload?.reason === "member_already_claimed") {
          setError(t("errors.memberAlreadyClaimed"));
        } else if (payload?.reason === "hq_user_required") {
          setError(t("errors.hqUserRequired"));
        } else {
          setError(t("linkFailed"));
        }
        return;
      }
      router.push(backHref);
      router.refresh();
    } catch {
      setError(t("linkFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(action: "resolve" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${resolveUrlPrefix}/${review.request.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("resolve_failed");
      router.push(backHref);
      router.refresh();
    } catch {
      setError(t("resolveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function renderRosterGroup(
    title: string,
    rows: HelpRequestRosterRow[],
    claimed: boolean,
  ) {
    if (rows.length === 0) {
      return (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-sm text-[#8b949e]">{t("roster.empty")}</p>
        </section>
      );
    }

    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <ul className="space-y-2">
          {rows.map((row) => {
            const selected = selectedMemberId === row.ashedMemberId;
            return (
              <li key={row.ashedMemberId}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 min-w-0 ${
                    selected
                      ? "border-[#388bfd] bg-[#388bfd]/10"
                      : "border-[#30363d] bg-[#161b22]"
                  }`}
                >
                  <input
                    type="radio"
                    name="roster-member"
                    className="mt-1 shrink-0"
                    checked={selected}
                    onChange={() => setSelectedMemberId(row.ashedMemberId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">
                      {row.currentName}
                    </span>
                    {row.nameMatchHint ? (
                      <span className="mt-1 inline-block rounded border border-[#238636] bg-[#238636]/10 px-2 py-0.5 text-xs text-[#3fb950]">
                        {t("roster.nameMatch")}
                      </span>
                    ) : null}
                    {claimed ? (
                      <span className="mt-1 block text-xs text-[#8b949e]">
                        {t("roster.claimedBadge")}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      <div>
        <Link
          href={backHref}
          className="inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {backLabel}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{t("title")}</h1>
        {showAlliance ? (
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[#58a6ff]">
            {review.request.allianceTag ?? review.request.allianceName}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[#8b949e]">
          <FormattedDateTime value={review.request.createdAt} />
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3">
        <h2 className="text-sm font-semibold">{t("identity.title")}</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[#8b949e]">{t("identity.submittedName")}</dt>
            <dd>{review.request.reportedName ?? t("identity.missing")}</dd>
          </div>
          <div>
            <dt className="text-[#8b949e]">{t("identity.uidLast4")}</dt>
            <dd>
              {review.request.gameUidLast4
                ? t("identity.uidLast4Value", {
                    last4: review.request.gameUidLast4,
                  })
                : t("identity.missing")}
            </dd>
          </div>
          <div>
            <dt className="text-[#8b949e]">{t("identity.lookupName")}</dt>
            <dd>
              {review.request.gameUserName ?? t("identity.lookupMissing")}
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("requesterContact.title")}</h2>
        <ContactBlock
          title={t("requesterContact.title")}
          name={requesterName}
          email={review.requester.email}
          discord={review.requester.discordUsername}
          emptyLabel={t("contact.noContact")}
        />
      </section>

      {renderRosterGroup(t("roster.unclaimedTitle"), review.roster.unclaimed, false)}
      {renderRosterGroup(t("roster.claimedTitle"), review.roster.claimed, true)}

      {selectedUnclaimed ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void linkSelected()}
            className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
          >
            {t("actions.linkSelected")}
          </button>
        </div>
      ) : null}

      {selectedClaimed ? (
        <section className="space-y-3 rounded-xl border border-[#9e6a03] bg-[#9e6a031a] p-4">
          <h2 className="text-sm font-semibold text-[#e3b341]">
            {t("mediation.title")}
          </h2>
          <p className="text-sm text-[#c9d1d9]">{t("mediation.description")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ContactBlock
              title={t("mediation.requester")}
              name={requesterName}
              email={review.requester.email}
              discord={review.requester.discordUsername}
              emptyLabel={t("contact.noContact")}
            />
            <ContactBlock
              title={t("mediation.claimant")}
              name={claimContactName(selectedClaimed.claim)}
              email={claimContactEmail(selectedClaimed.claim)}
              discord={claimContactDiscord(selectedClaimed.claim)}
              emptyLabel={t("contact.noClaimantContact")}
            />
          </div>
          <button
            type="button"
            disabled
            title={t("unlinkFutureHint")}
            className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e] opacity-60 sm:w-auto"
          >
            {t("unlinkFuture")}
          </button>
        </section>
      ) : null}

      {!selectedUnclaimed && !selectedClaimed ? (
        <p className="text-sm text-[#8b949e]">{t("noMatchHint")}</p>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-2 border-t border-[#30363d] pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("resolve")}
          className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-sm disabled:opacity-50 sm:w-auto"
        >
          {t("actions.markResolved")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("dismiss")}
          className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e] disabled:opacity-50 sm:w-auto"
        >
          {t("actions.dismiss")}
        </button>
      </div>
    </div>
  );
}
