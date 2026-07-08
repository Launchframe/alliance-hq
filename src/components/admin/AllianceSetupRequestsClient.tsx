"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";

export type AllianceSetupRequestRow = {
  id: string;
  tag: string;
  allianceName: string;
  gameServerNumber: number;
  requesterEmail: string | null;
  createdAt: string;
};

type Props = {
  initialRequests: AllianceSetupRequestRow[];
};

export function AllianceSetupRequestsClient({ initialRequests }: Props) {
  const t = useTranslations("admin.allianceSetupRequests");
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  function buildCreateAllianceHref(request: AllianceSetupRequestRow): string {
    const params = new URLSearchParams({
      setupName: request.allianceName,
      setupTag: request.tag,
      setupServer: String(request.gameServerNumber),
    });
    if (request.requesterEmail?.trim()) {
      params.set("setupOwnerEmail", request.requesterEmail.trim());
    }
    return `/admin/alliances?${params.toString()}`;
  }

  async function dismissRequest(requestId: string) {
    setBusyId(requestId);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/admin/alliance-setup-requests/${encodeURIComponent(requestId)}/dismiss`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!res.ok) {
        throw new Error(t("dismissFailed"));
      }
      setRequests((current) => current.filter((row) => row.id !== requestId));
      setFeedback(t("dismissed"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("dismissFailed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        <Link
          href="/admin"
          className="mt-2 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {t("backToAdmin")}
        </Link>
      </div>

      {feedback ? (
        <p className="text-sm text-[#3fb950]" role="status">
          {feedback}
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
                <p className="font-medium text-[#e6edf3]">{request.allianceName}</p>
                <p className="text-sm text-[#8b949e] mt-1">
                  {t("tag", { tag: request.tag })}
                </p>
                <p className="text-sm text-[#8b949e]">
                  {t("serverNumber", { number: request.gameServerNumber })}
                </p>
                <p className="text-sm text-[#8b949e] mt-1">
                  {request.requesterEmail
                    ? t("requesterEmail", { email: request.requesterEmail })
                    : t("requesterUnknown")}
                </p>
                <p className="text-xs text-[#6e7681] mt-2">
                  <FormattedDateTime value={request.createdAt} />
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href={buildCreateAllianceHref(request)}
                  className="inline-flex rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
                >
                  {t("provisionButton")}
                </Link>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => void dismissRequest(request.id)}
                  className="inline-flex rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:border-[#f85149] disabled:opacity-50"
                >
                  {t("dismissButton")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
