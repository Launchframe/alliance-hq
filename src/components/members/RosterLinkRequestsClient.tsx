"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type PendingRequest = {
  id: string;
  origin: string;
  reportedName: string;
  gameUserName: string;
  gameUidLast4: string;
  gameServerNumber: number | null;
  discordUsername: string | null;
  suggestedTargetAshedMemberId: string | null;
  suggestionMethod: string | null;
  suggestedMatchedRosterName: string | null;
};

type RosterMember = {
  id: string;
  current_name: string;
};

export function RosterLinkRequestsClient({
  initialRequests,
  initialMembers,
}: {
  initialRequests: PendingRequest[];
  initialMembers: RosterMember[];
}) {
  const t = useTranslations("rosterLinkRequests");
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("request");

  const [requests, setRequests] = useState(initialRequests);
  const [members, setMembers] = useState(initialMembers);
  // User overrides only. The displayed selection is derived during render so a
  // suggested match can preselect without a sync effect (and the officer can
  // still clear or change it). Storing "" here means "officer cleared it".
  const [selectedMemberByRequest, setSelectedMemberByRequest] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  function suggestedMemberFor(request: PendingRequest): RosterMember | null {
    if (!request.suggestedTargetAshedMemberId) return null;
    return memberById.get(request.suggestedTargetAshedMemberId) ?? null;
  }

  function effectiveSelection(request: PendingRequest): string {
    const override = selectedMemberByRequest[request.id];
    if (override !== undefined) return override;
    return suggestedMemberFor(request)?.id ?? "";
  }

  async function reload() {
    setError(null);
    try {
      const [reqRes, membersRes] = await Promise.all([
        fetch("/api/members/roster-link-requests"),
        fetch("/api/members"),
      ]);
      if (!reqRes.ok) {
        throw new Error("requests");
      }
      const reqJson = (await reqRes.json()) as { requests: PendingRequest[] };
      setRequests(reqJson.requests);

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

  const sortedRequests = useMemo(() => {
    if (!highlightId) return requests;
    return [...requests].sort((a, b) => {
      if (a.id === highlightId) return -1;
      if (b.id === highlightId) return 1;
      return 0;
    });
  }, [highlightId, requests]);

  async function resolve(
    requestId: string,
    action: "accept" | "reject",
    targetAshedMemberId?: string | null,
  ) {
    setBusyId(requestId);
    setError(null);
    try {
      const res = await fetch(`/api/members/roster-link-requests/${requestId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetAshedMemberId: targetAshedMemberId ?? null }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "resolve_failed");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resolveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
        <Link href="/members" className="mt-2 inline-block text-sm text-hq-accent hover:underline">
          {t("backToMembers")}
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {sortedRequests.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {sortedRequests.map((request) => {
            const suggested = suggestedMemberFor(request);
            // A suggestion was stored, but the suggested member is no longer in
            // the loaded roster (renamed/left). Tell the officer to pick manually
            // instead of silently dropping the hint.
            const suggestionStale =
              !suggested && Boolean(request.suggestedTargetAshedMemberId);
            const selection = effectiveSelection(request);
            return (
            <li
              key={request.id}
              className={`rounded-xl border p-4 space-y-3 min-w-0 ${
                request.id === highlightId
                  ? "border-hq-accent bg-[#58a6ff1a]"
                  : "border-hq-border bg-hq-surface"
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium">{request.gameUserName}</p>
                <p className="text-xs text-hq-fg-muted mt-1">
                  {t("typedName", { name: request.reportedName })}
                </p>
                <p className="text-xs text-hq-fg-muted">
                  {t("uidLast4", { last4: request.gameUidLast4 })}
                  {request.gameServerNumber != null
                    ? ` · ${t("server", { server: request.gameServerNumber })}`
                    : null}
                  {request.origin === "discord"
                    ? ` · ${t("originDiscord", {
                        user: request.discordUsername ?? t("originDiscordUnknown"),
                      })}`
                    : ` · ${t("originWeb")}`}
                </p>
              </div>

              {suggested ? (
                <p
                  className="rounded-lg border border-[#9e6a03] bg-[#9e6a031a] px-3 py-2 text-xs text-[#e3b341]"
                  role="note"
                >
                  {t("suggestionBanner", {
                    suggested:
                      request.suggestedMatchedRosterName ?? suggested.current_name,
                    gameName: request.gameUserName,
                  })}
                </p>
              ) : null}

              {suggestionStale ? (
                <p
                  className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-xs text-hq-fg-muted"
                  role="note"
                >
                  {t("suggestionStale", {
                    suggested: request.suggestedMatchedRosterName ?? "",
                  })}
                </p>
              ) : null}

              <label className="block text-xs text-hq-fg-muted">
                {t("matchLabel")}
                <select
                  className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-foreground"
                  value={selection}
                  onChange={(event) =>
                    setSelectedMemberByRequest((prev) => ({
                      ...prev,
                      [request.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">{t("matchPlaceholder")}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.current_name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={busyId === request.id || !selection}
                  onClick={() => void resolve(request.id, "accept", selection)}
                  className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t("approveMatch")}
                </button>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => void resolve(request.id, "reject")}
                  className="rounded-lg border border-hq-border px-4 py-2 text-sm text-foreground disabled:opacity-50"
                >
                  {t("decline")}
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
