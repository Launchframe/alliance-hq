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
  const [selectedMemberByRequest, setSelectedMemberByRequest] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        <Link href="/members" className="mt-2 inline-block text-sm text-[#58a6ff] hover:underline">
          {t("backToMembers")}
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {sortedRequests.length === 0 ? (
        <p className="text-sm text-[#8b949e]">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {sortedRequests.map((request) => (
            <li
              key={request.id}
              className={`rounded-xl border p-4 space-y-3 min-w-0 ${
                request.id === highlightId
                  ? "border-[#58a6ff] bg-[#58a6ff1a]"
                  : "border-[#30363d] bg-[#161b22]"
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium">{request.gameUserName}</p>
                <p className="text-xs text-[#8b949e] mt-1">
                  {t("typedName", { name: request.reportedName })}
                </p>
                <p className="text-xs text-[#8b949e]">
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

              <label className="block text-xs text-[#8b949e]">
                {t("matchLabel")}
                <select
                  className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-foreground"
                  value={selectedMemberByRequest[request.id] ?? ""}
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
                  disabled={busyId === request.id || !selectedMemberByRequest[request.id]}
                  onClick={() =>
                    void resolve(
                      request.id,
                      "accept",
                      selectedMemberByRequest[request.id],
                    )
                  }
                  className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t("approveMatch")}
                </button>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => void resolve(request.id, "reject")}
                  className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-foreground disabled:opacity-50"
                >
                  {t("decline")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
