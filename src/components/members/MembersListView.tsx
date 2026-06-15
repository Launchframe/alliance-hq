"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import { Link } from "@/i18n/navigation";
import type { AllianceMembersPayload } from "@/lib/members/load";
import type { AshedMember } from "@/lib/video/member-matcher";
import { ashedUrlForPath } from "@/lib/nav/routes";

type Props = {
  initial: AllianceMembersPayload;
};

function memberStatusLabel(
  status: string | undefined,
  t: (key: "statusActive" | "statusFormer") => string,
): string {
  if (status === "former") {
    return t("statusFormer");
  }
  if (status === "active" || !status) {
    return t("statusActive");
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberStatusBadgeClass(status?: string): string {
  const base =
    "inline-flex min-w-[5.5rem] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (status === "former") {
    return `${base} bg-[#30363d] text-[#8b949e] ring-1 ring-[#484f58]`;
  }
  return `${base} bg-[#23863633] text-[#3fb950] ring-1 ring-[#23863666]`;
}

export function MembersListView({ initial }: Props) {
  const t = useTranslations("members");
  const formatDateTime = useFormatAccountDateTime();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [showFormer, setShowFormer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.members.filter((member) => {
      if (!showFormer && member.status === "former") {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = [
        member.current_name,
        ...(member.previous_names ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [data.members, query, showFormer]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/members");
      const body = (await res.json()) as AllianceMembersPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("loadFailed"));
        return;
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  const ashedMembersUrl = ashedUrlForPath("/members");

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
          <p className="mt-2 text-sm">
            {t("allianceLine", {
              tag: data.alliance.tag,
              name: data.alliance.name ?? data.alliance.tag,
            })}
          </p>
          <p className="mt-1 text-xs text-[#8b949e]">
            {t("counts", {
              active: data.counts.active,
              former: data.counts.former,
              total: data.counts.total,
            })}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="w-full rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm disabled:opacity-50 sm:w-auto"
          >
            {refreshing ? t("refreshing") : t("refresh")}
          </button>
          <a
            href={ashedMembersUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm text-white hover:bg-[#2ea043] sm:w-auto"
          >
            {t("openInAshed")}
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-xs text-[#8b949e]">{t("search")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[#8b949e] sm:pt-5">
          <input
            type="checkbox"
            checked={showFormer}
            onChange={(e) => setShowFormer(e.target.checked)}
          />
          {t("showFormer")}
        </label>
      </div>

      {error && <p className="text-sm text-[#f85149]">{error}</p>}

      <p className="text-xs text-[#8b949e]">
        {t("lastSynced", {
          time: formatDateTime(data.fetchedAt),
        })}
      </p>

      <div className="min-w-0 overflow-hidden rounded-xl border border-[#30363d]">
        <table className="w-full min-w-0 table-fixed text-left text-sm md:table-auto">
          <thead className="border-b border-[#30363d] bg-[#161b22] text-xs uppercase tracking-wide text-[#8b949e]">
            <tr>
              <th className="px-3 py-3 font-medium md:hidden sm:px-4">
                {t("colName")}
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                {t("colName")}
              </th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                {t("colPreviousNames")}
              </th>
              <th className="hidden px-4 py-3 text-center font-medium md:table-cell">
                {t("colStatus")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-[#8b949e] sm:px-4"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              filtered.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: AshedMember }) {
  const t = useTranslations("members");
  const previous =
    member.previous_names?.filter(Boolean).join(", ") || t("noPreviousNames");
  const statusLabel = memberStatusLabel(member.status, t);
  const statusBadge = (
    <span className={memberStatusBadgeClass(member.status)}>
      {statusLabel}
    </span>
  );

  return (
    <tr className="border-b border-[#30363d]/60 last:border-0 hover:bg-[#161b22]/80">
      <td className="px-3 py-3 md:hidden sm:px-4">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <div className="wrap-break-word font-medium">{member.current_name}</div>
          <div className="wrap-break-word text-xs text-[#8b949e]">
            <span className="font-medium text-[#6e7681]">
              {t("colPreviousNames")}:{" "}
            </span>
            {previous}
          </div>
          {statusBadge}
        </div>
      </td>
      <td className="hidden px-4 py-3 font-medium md:table-cell">
        {member.current_name}
      </td>
      <td className="hidden wrap-break-word px-4 py-3 text-[#8b949e] md:table-cell">
        {previous}
      </td>
      <td className="hidden px-4 py-3 text-center md:table-cell">
        {statusBadge}
      </td>
    </tr>
  );
}

function MembersListMissingTag() {
  const t = useTranslations("members");
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-[#d29922]/40 bg-[#d29922]/10 p-6">
      <h1 className="text-xl font-semibold text-[#e3b341]">{t("title")}</h1>
      <p className="text-sm text-[#8b949e]">{t("missingTag")}</p>
      <Link
        href="/settings"
        className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
      >
        {t("goToSettings")}
      </Link>
    </div>
  );
}

export function MembersListViewOrSetup(props: Props | { missingTag: true }) {
  if ("missingTag" in props) {
    return <MembersListMissingTag />;
  }
  return <MembersListView initial={props.initial} />;
}
