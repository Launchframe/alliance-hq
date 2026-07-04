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
import {
  filterHelpRequestRosterRows,
  helpRequestRequesterInGameName,
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
  const [review, setReview] = useState(initialReview);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unclaimedSearch, setUnclaimedSearch] = useState("");
  const [notifiedClaimant, setNotifiedClaimant] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const isResolved = review.request.status !== "open";

  const filteredUnclaimed = useMemo(
    () =>
      filterHelpRequestRosterRows(review.roster.unclaimed, unclaimedSearch),
    [review.roster.unclaimed, unclaimedSearch],
  );

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
    helpRequestRequesterInGameName({
      context: review.request.context,
      reportedName: review.request.reportedName,
      gameUserName: review.request.gameUserName,
      requesterHandle: review.requester.requesterHandle,
    }) || review.requester.requesterHandle;

  const rosterName = review.request.reportedName?.trim() ?? "";
  const lookupName = review.request.gameUserName?.trim() ?? "";
  const showNameReview =
    review.request.context === "claim_conflict" &&
    (review.request.claimConflictReason === "target_mismatch" ||
      review.request.claimConflictReason === "name_collision") &&
    Boolean(rosterName && lookupName);

  async function resolveNameReview(chosen: "roster" | "lookup") {
    setBusy(true);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch(
        `${resolveUrlPrefix}/${review.request.id}/resolve-name`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chosen }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        memberName?: string;
      };
      if (!res.ok) {
        setActionNotice({
          tone: "error",
          message: body.error ?? t("nameReview.failed"),
        });
        return;
      }
      setActionNotice({
        tone: "success",
        message: t("nameReview.success", {
          name: body.memberName ?? (chosen === "lookup" ? lookupName : rosterName),
        }),
      });
      await refreshReview();
      router.refresh();
    } catch {
      setActionNotice({ tone: "error", message: t("nameReview.failed") });
    } finally {
      setBusy(false);
    }
  }

  async function refreshReview(): Promise<ReviewPayload | null> {
    const res = await fetch(`${linkUrlPrefix}/${review.request.id}/review`);
    if (!res.ok) {
      setActionNotice({ tone: "error", message: t("refreshFailed") });
      return null;
    }
    const payload = (await res.json()) as { review?: ReviewPayload };
    if (payload.review) {
      setReview(payload.review);
      return payload.review;
    }
    return null;
  }

  function selectRosterMember(ashedMemberId: string, options?: { keepNotice?: boolean }) {
    setSelectedMemberId(ashedMemberId);
    setNotifiedClaimant(false);
    setUnlinkConfirmOpen(false);
    if (!options?.keepNotice) {
      setActionNotice(null);
    }
  }

  async function unlinkClaimed() {
    if (!selectedClaimed || !notifiedClaimant) return;
    const unlinkedMemberId = selectedClaimed.ashedMemberId;
    const unlinkedName = selectedClaimed.currentName;
    setBusy(true);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`${linkUrlPrefix}/${review.request.id}/unlink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAshedMemberId: unlinkedMemberId,
          notifiedClaimant: true,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        memberName?: string;
      } | null;
      if (!res.ok) {
        if (payload?.reason === "not_linked") {
          setError(t("errors.notLinked"));
        } else {
          setError(t("unlinkFailed"));
        }
        return;
      }
      setUnlinkConfirmOpen(false);
      setNotifiedClaimant(false);
      const refreshed = await refreshReview();
      const memberName = payload?.memberName ?? unlinkedName;
      setActionNotice({
        tone: "success",
        message: t("unlinkSuccess", { name: memberName }),
      });
      const nextSelect =
        refreshed?.roster.unclaimed.find(
          (row) => row.ashedMemberId === unlinkedMemberId,
        )?.ashedMemberId ??
        refreshed?.request.inviteTargetAshedMemberId ??
        unlinkedMemberId;
      selectRosterMember(nextSelect, { keepNotice: true });
      router.refresh();
    } catch {
      setError(t("unlinkFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function linkSelected() {
    if (!selectedUnclaimed) return;
    setBusy(true);
    setError(null);
    setActionNotice(null);
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
      const linkedMemberId = selectedUnclaimed.ashedMemberId;
      const memberName = payload?.memberName ?? selectedUnclaimed.currentName;
      const refreshed = await refreshReview();
      setActionNotice({
        tone: "success",
        message: t("linkSuccess", {
          memberName,
          requesterName,
        }),
      });
      const claimedId =
        refreshed?.roster.claimed.find(
          (row) => row.ashedMemberId === linkedMemberId,
        )?.ashedMemberId ?? linkedMemberId;
      selectRosterMember(claimedId, { keepNotice: true });
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

  function renderRosterList(
    rows: HelpRequestRosterRow[],
    claimed: boolean,
    options?: { scrollable?: boolean; emptyMessage?: string },
  ) {
    if (rows.length === 0) {
      return (
        <p className="text-sm text-[#8b949e]">
          {options?.emptyMessage ?? t("roster.empty")}
        </p>
      );
    }

    const list = (
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
                    onChange={() => selectRosterMember(row.ashedMemberId)}
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
    );

    if (options?.scrollable) {
      return (
        <div className="max-h-[min(24rem,50vh)] overflow-y-auto pr-1">
          {list}
        </div>
      );
    }

    return list;
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
        {renderRosterList(rows, claimed)}
      </section>
    );
  }

  function renderUnclaimedRosterGroup() {
    const rows = review.roster.unclaimed;
    if (rows.length === 0) {
      return (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t("roster.unclaimedTitle")}</h2>
          <p className="text-sm text-[#8b949e]">{t("roster.empty")}</p>
        </section>
      );
    }

    return (
      <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-semibold">{t("roster.unclaimedTitle")}</h2>
        <input
          type="search"
          value={unclaimedSearch}
          onChange={(e) => setUnclaimedSearch(e.target.value)}
          placeholder={t("roster.searchPlaceholder")}
          aria-label={t("roster.searchPlaceholder")}
          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder:text-[#8b949e] focus:border-[#58a6ff] focus:outline-none"
        />
        {renderRosterList(filteredUnclaimed, false, {
          scrollable: rows.length > 6,
          emptyMessage: t("roster.searchNoResults"),
        })}
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

      {busy ? (
        <p className="text-sm text-[#58a6ff]" role="status" aria-live="polite">
          {t("working")}
        </p>
      ) : null}

      {actionNotice ? (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${
            actionNotice.tone === "success"
              ? "border-[#238636] bg-[#238636]/10 text-[#3fb950]"
              : "border-[#da3633] bg-[#da3633]/10 text-[#f85149]"
          }`}
          role="status"
        >
          {actionNotice.message}
        </p>
      ) : null}

      {isResolved ? (
        <section className="rounded-xl border border-[#238636] bg-[#238636]/10 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[#3fb950]">
            {t("completed.title")}
          </h2>
          <p className="text-sm text-[#c9d1d9]">{t("completed.description")}</p>
          <Link
            href={backHref}
            className="inline-block text-sm font-medium text-[#58a6ff] hover:underline"
          >
            {backLabel}
          </Link>
        </section>
      ) : null}

      {showNameReview ? (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3">
          <h2 className="text-sm font-semibold">{t("nameReview.title")}</h2>
          <p className="text-sm text-[#8b949e]">{t("nameReview.body")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || isResolved || !rosterName}
              onClick={() => void resolveNameReview("roster")}
              className="rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 text-sm text-[#e6edf3] disabled:opacity-50"
            >
              {t("nameReview.keepRoster", { name: rosterName })}
            </button>
            <button
              type="button"
              disabled={busy || isResolved || !lookupName}
              onClick={() => void resolveNameReview("lookup")}
              className="rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
            >
              {t("nameReview.useLookup", { name: lookupName })}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3">
        <h2 className="text-sm font-semibold">{t("identity.title")}</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[#8b949e]">
              {review.request.context === "claim_conflict"
                ? t("identity.invitedCommander")
                : t("identity.submittedName")}
            </dt>
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
          {review.request.context === "claim_conflict" &&
          review.request.claimConflictReason ? (
            <div>
              <dt className="text-[#8b949e]">
                {t("claimConflictReason.label")}
              </dt>
              <dd>
                {t(
                  `claimConflictReason.${review.request.claimConflictReason}`,
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="space-y-3">
        <ContactBlock
          title={t("requesterContact.title")}
          name={requesterName}
          email={review.requester.email}
          discord={review.requester.discordUsername}
          emptyLabel={t("contact.noContact")}
        />
      </section>

      {renderUnclaimedRosterGroup()}
      {renderRosterGroup(t("roster.claimedTitle"), review.roster.claimed, true)}

      {isResolved && selectedClaimed?.claim ? (
        <section className="space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-sm font-semibold">{t("currentClaim.title")}</h2>
          <p className="text-sm text-[#8b949e]">{t("currentClaim.description")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ContactBlock
              title={t("mediation.requester")}
              name={requesterName}
              email={review.requester.email}
              discord={review.requester.discordUsername}
              emptyLabel={t("contact.noContact")}
            />
            <ContactBlock
              title={t("currentClaim.holder")}
              name={claimContactName(selectedClaimed.claim)}
              email={claimContactEmail(selectedClaimed.claim)}
              discord={claimContactDiscord(selectedClaimed.claim)}
              emptyLabel={t("contact.noClaimantContact")}
            />
          </div>
        </section>
      ) : null}

      {!isResolved && selectedUnclaimed ? (
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

      {!isResolved && selectedClaimed ? (
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
          <label className="flex items-start gap-2 text-sm text-[#c9d1d9]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={notifiedClaimant}
              onChange={(e) => {
                setNotifiedClaimant(e.target.checked);
                if (!e.target.checked) setUnlinkConfirmOpen(false);
              }}
            />
            <span>{t("mediation.notifiedClaimant")}</span>
          </label>
          {unlinkConfirmOpen ? (
            <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
              <p className="text-sm font-medium">{t("unlinkConfirmQuestion")}</p>
              <p className="text-sm text-[#8b949e]">
                {t("unlinkConfirmDescription", {
                  name: selectedClaimed.currentName,
                })}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void unlinkClaimed()}
                  className="w-full rounded-lg bg-[#da3633] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
                >
                  {busy ? t("unlinkBusy") : t("unlinkConfirm")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setUnlinkConfirmOpen(false)}
                  className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-sm disabled:opacity-50 sm:w-auto"
                >
                  {t("unlinkCancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!notifiedClaimant || busy}
              onClick={() => setUnlinkConfirmOpen(true)}
              className="w-full rounded-lg border border-[#da3633] px-4 py-2 text-sm text-[#f85149] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {t("actions.unlinkClaim")}
            </button>
          )}
        </section>
      ) : null}

      {!isResolved && !selectedUnclaimed && !selectedClaimed ? (
        <p className="text-sm text-[#8b949e]">{t("noMatchHint")}</p>
      ) : null}

      {!isResolved ? (
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
      ) : null}
    </div>
  );
}
