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
  detailHrefPrefix: string;
  showAlliance?: boolean;
  backHref?: string;
  backLabel?: string;
  titleKey?: "title" | "adminTitle";
};

export function MemberLinkHelpRequestsClient({
  initialRequests,
  detailHrefPrefix,
  showAlliance = false,
  backHref,
  backLabel,
  titleKey = "title",
}: Props) {
  const t = useTranslations("memberLinkHelpRequests");
  const [requests, setRequests] = useState(initialRequests);
  const [error] = useState<string | null>(null);

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

              <Link
                href={`${detailHrefPrefix}/${request.id}`}
                className="inline-flex w-full sm:w-auto justify-center rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
              >
                {t("reviewRequest")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
