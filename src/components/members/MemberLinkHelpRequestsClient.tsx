"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";

export type MemberLinkHelpRequestView = {
  id: string;
  allianceId: string;
  allianceTag: string | null;
  allianceName: string | null;
  origin: "web" | "discord";
  context:
    | "onboarding_form"
    | "walkthrough"
    | "roster_miss"
    | "discord_button";
  requesterHandle: string;
  reportedName: string | null;
  gameUserName: string | null;
  gameUidLast4: string | null;
  discordUsername: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
};

type Props = {
  initialRequests: MemberLinkHelpRequestView[];
  listUrl: string;
  resolveUrlPrefix: string;
  showAlliance?: boolean;
  backHref?: string;
  backLabel?: string;
  titleKey?: "title" | "adminTitle";
};

export function MemberLinkHelpRequestsClient({
  initialRequests,
  listUrl,
  resolveUrlPrefix,
  showAlliance = false,
  backHref,
  backLabel,
  titleKey = "title",
}: Props) {
  const t = useTranslations("memberLinkHelpRequests");
  const [requests, setRequests] = useState(initialRequests);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const res = await fetch(`${listUrl}?status=open`);
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as { requests: MemberLinkHelpRequestView[] };
      setRequests(json.requests);
    } catch {
      setError(t("loadFailed"));
    }
  }

  async function resolve(id: string, action: "resolve" | "dismiss") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${resolveUrlPrefix}/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
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

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      <div>
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        {backHref && backLabel ? (
          <Link
            href={backHref}
            className="mt-2 inline-block text-sm text-[#58a6ff] hover:underline"
          >
            {backLabel}
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <p className="text-sm text-[#8b949e]">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {requests.map((request) => (
            <li
              key={request.id}
              className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 space-y-3 min-w-0"
            >
              <div className="min-w-0">
                {showAlliance ? (
                  <p className="text-xs font-medium uppercase tracking-wide text-[#58a6ff]">
                    {request.allianceTag ?? request.allianceName ?? t("unknownAlliance")}
                  </p>
                ) : null}
                <p className="font-medium">
                  {request.gameUserName ?? request.requesterHandle}
                </p>
                <p className="text-xs text-[#8b949e] mt-1">
                  {t("requester", { handle: request.requesterHandle })}
                </p>
                {request.reportedName ? (
                  <p className="text-sm text-[#c9d1d9] mt-1">
                    {t("typedName", { name: request.reportedName })}
                  </p>
                ) : null}
                {request.gameUidLast4 ? (
                  <p className="text-sm text-[#c9d1d9]">
                    {t("uidLast4", { last4: request.gameUidLast4 })}
                  </p>
                ) : null}
                <p className="text-xs text-[#8b949e] mt-2">
                  {request.origin === "discord"
                    ? t("originDiscord", {
                        user: request.discordUsername ?? t("originDiscordUnknown"),
                      })
                    : t("originWeb")}
                </p>
                <p className="mt-2 inline-block rounded-lg border border-[#9e6a03] bg-[#9e6a031a] px-2 py-1 text-xs text-[#e3b341]">
                  {t(`context.${request.context}`)}
                </p>
                <p className="text-xs text-[#6e7681] mt-2">
                  <FormattedDateTime value={request.createdAt} />
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => void resolve(request.id, "resolve")}
                  className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t("markResolved")}
                </button>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => void resolve(request.id, "dismiss")}
                  className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-foreground disabled:opacity-50"
                >
                  {t("dismiss")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
