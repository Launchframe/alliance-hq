"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type PendingReview = {
  id: string;
  origin: string;
  gameUserName: string;
  gameUidLast4: string;
  gameServerNumber: number | null;
  linkedAshedMemberId: string;
  linkedRosterName: string;
  discordUsername: string | null;
  requesterHandle: string | null;
  requesterEmail: string | null;
  suggestedTargetAshedMemberId: string | null;
  suggestionMethod: string | null;
  suggestedMatchedRosterName: string | null;
  inviteId: string | null;
  joinCodeId: string | null;
};

type RosterMember = {
  id: string;
  current_name: string;
};

export function OnboardingReviewsClient({
  initialReviews,
  initialMembers,
}: {
  initialReviews: PendingReview[];
  initialMembers: RosterMember[];
}) {
  const t = useTranslations("onboardingReviews");
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("review");

  const [reviews, setReviews] = useState(initialReviews);
  const [members, setMembers] = useState(initialMembers);
  const [selectedMemberByReview, setSelectedMemberByReview] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmApproveAll, setConfirmApproveAll] = useState(false);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const unlinkedMembers = useMemo(
    () => members.filter((member) => member.current_name.trim().length > 0),
    [members],
  );

  function suggestedMemberFor(review: PendingReview): RosterMember | null {
    if (!review.suggestedTargetAshedMemberId) return null;
    return memberById.get(review.suggestedTargetAshedMemberId) ?? null;
  }

  function effectiveSelection(review: PendingReview): string {
    const override = selectedMemberByReview[review.id];
    if (override !== undefined) return override;
    return suggestedMemberFor(review)?.id ?? "";
  }

  async function reload() {
    setError(null);
    try {
      const [reviewRes, membersRes] = await Promise.all([
        fetch("/api/members/onboarding-reviews"),
        fetch("/api/members"),
      ]);
      if (!reviewRes.ok) throw new Error("reviews");
      const reviewJson = (await reviewRes.json()) as {
        reviews: PendingReview[];
      };
      setReviews(reviewJson.reviews);
      if (membersRes.ok) {
        const membersJson = (await membersRes.json()) as {
          members?: RosterMember[];
        };
        setMembers(membersJson.members ?? []);
      }
    } catch {
      setError(t("loadFailed"));
    }
  }

  const sortedReviews = useMemo(() => {
    if (!highlightId) return reviews;
    return [...reviews].sort((a, b) => {
      if (a.id === highlightId) return -1;
      if (b.id === highlightId) return 1;
      return 0;
    });
  }, [highlightId, reviews]);

  async function resolve(
    reviewId: string,
    action: "approve" | "merge" | "dismiss",
    targetAshedMemberId?: string | null,
  ) {
    setBusyId(reviewId);
    setError(null);
    try {
      const res = await fetch(
        `/api/members/onboarding-reviews/${reviewId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, targetAshedMemberId: targetAshedMemberId ?? null }),
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "resolve_failed");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resolveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function approveAll() {
    setBusyId("approve-all");
    setError(null);
    try {
      const res = await fetch("/api/members/onboarding-reviews/approve-all", {
        method: "POST",
      });
      if (!res.ok) throw new Error("approve_all_failed");
      setConfirmApproveAll(false);
      await reload();
    } catch {
      setError(t("approveAllFailed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
          <Link
            href="/members"
            className="mt-2 inline-block text-sm text-hq-accent hover:underline"
          >
            {t("backToMembers")}
          </Link>
        </div>
        {reviews.length > 0 ? (
          <button
            type="button"
            disabled={busyId === "approve-all"}
            onClick={() => setConfirmApproveAll(true)}
            className="rounded-lg border border-hq-success bg-hq-success/10 px-4 py-2 text-sm text-hq-green hover:bg-hq-success/20 disabled:opacity-50"
          >
            {t("approveAll")}
          </button>
        ) : null}
      </div>

      {confirmApproveAll ? (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-4 space-y-3">
          <p className="text-sm">{t("approveAllConfirmBody", { count: reviews.length })}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void approveAll()}
              className="rounded-lg bg-hq-success px-4 py-2 text-sm text-white"
            >
              {t("approveAllConfirmAction")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmApproveAll(false)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm"
            >
              {t("approveAllCancel")}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {sortedReviews.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
          <p className="text-xs text-hq-fg-subtle">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {sortedReviews.map((review) => {
            const suggested = suggestedMemberFor(review);
            const suggestionStale =
              !suggested && Boolean(review.suggestedTargetAshedMemberId);
            const selection = effectiveSelection(review);
            const hqHandle =
              review.requesterHandle ??
              review.requesterEmail ??
              review.discordUsername ??
              "—";

            return (
              <li
                key={review.id}
                className={`rounded-xl border p-4 space-y-3 min-w-0 ${
                  review.id === highlightId
                    ? "border-hq-accent bg-[#58a6ff1a]"
                    : "border-hq-border bg-hq-surface"
                }`}
              >
                <div className="grid gap-3 sm:grid-cols-2 min-w-0">
                  <div>
                    <p className="text-xs text-hq-fg-muted">{t("commanderNameLabel")}</p>
                    <p className="font-medium">{review.gameUserName}</p>
                  </div>
                  {review.suggestedMatchedRosterName ? (
                    <div>
                      <p className="text-xs text-hq-fg-muted">
                        {t("suggestedRosterNameLabel")}
                      </p>
                      <p className="font-medium">{review.suggestedMatchedRosterName}</p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs text-hq-fg-muted">{t("linkedRosterNameLabel")}</p>
                    <p>{review.linkedRosterName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-hq-fg-muted">
                      {review.requesterEmail
                        ? t("requester", { handle: hqHandle })
                        : review.discordUsername
                          ? t("requesterDiscord", { user: review.discordUsername })
                          : t("requester", { handle: hqHandle })}
                    </p>
                    {review.requesterEmail ? (
                      <p className="text-sm">{t("requesterEmail", { email: review.requesterEmail })}</p>
                    ) : null}
                  </div>
                </div>

                <p className="text-xs text-hq-fg-muted">
                  {t("uidLast4", { last4: review.gameUidLast4 })}
                  {review.gameServerNumber != null
                    ? ` · ${t("server", { server: review.gameServerNumber })}`
                    : null}
                  {` · ${review.origin === "discord" ? t("originDiscord") : t("originWeb")}`}
                  {review.inviteId
                    ? ` · ${t("joinedViaInvite")}`
                    : review.joinCodeId
                      ? ` · ${t("joinedViaJoinCode")}`
                      : null}
                </p>

                {suggested ? (
                  <p
                    className="rounded-lg border border-[#9e6a03] bg-[#9e6a031a] px-3 py-2 text-xs text-[#e3b341]"
                    role="note"
                  >
                    {t("suggestionBanner", {
                      suggested:
                        review.suggestedMatchedRosterName ?? suggested.current_name,
                      linkedName: review.linkedRosterName,
                    })}
                  </p>
                ) : null}

                {suggestionStale ? (
                  <p
                    className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-xs text-hq-fg-muted"
                    role="note"
                  >
                    {t("suggestionStale", {
                      suggested: review.suggestedMatchedRosterName ?? "",
                    })}
                  </p>
                ) : null}

                <label className="block text-xs text-hq-fg-muted">
                  {t("matchLabel")}
                  <select
                    className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
                    value={selection}
                    onChange={(event) =>
                      setSelectedMemberByReview((prev) => ({
                        ...prev,
                        [review.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">{t("matchPlaceholder")}</option>
                    {unlinkedMembers
                      .filter((member) => member.id !== review.linkedAshedMemberId)
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.current_name}
                        </option>
                      ))}
                  </select>
                </label>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    disabled={busyId === review.id}
                    onClick={() => void resolve(review.id, "approve")}
                    className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t("approve")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === review.id || !selection}
                    onClick={() => void resolve(review.id, "merge", selection)}
                    className="rounded-lg border border-hq-accent bg-hq-accent/10 px-4 py-2 text-sm text-hq-accent disabled:opacity-50"
                  >
                    {t("linkToRoster")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === review.id}
                    onClick={() => void resolve(review.id, "dismiss")}
                    className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg disabled:opacity-50"
                  >
                    {t("dismiss")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
