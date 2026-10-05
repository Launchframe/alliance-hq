"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { VsMemberTable } from "@/components/vs-performance/VsMemberTable";
import {
  defaultSortDirection,
  VS_MEMBER_STATUS_KEYS,
  VS_MEMBER_SIGNAL_KEYS,
  vsMemberPolicyLineKey,
  vsMemberSourceKey,
  vsMembersFiltersActive,
  vsMembersPageRange,
  vsMembersQueryFromSearchParams,
  vsMembersQueryToApiParams,
  vsMembersQueryToSearchParams,
  type VsMembersViewQuery,
  type VsMemberWeekResponse,
} from "@/lib/vs-performance/member-performance-view.shared";
import {
  VS_MEMBER_SIGNALS,
  VS_MEMBER_STATUSES,
} from "@/lib/vs-performance/member-performance.shared";

type Props = {
  weekStart: string;
};

const inputCls =
  "rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-sm text-hq-fg placeholder:text-hq-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-hq-accent";

export function VsMemberPerformance({ weekStart }: Props) {
  const t = useTranslations("vsPerformance.members");
  const tActions = useTranslations("vsPerformance.actions");
  const tErrors = useTranslations("vsPerformance.errors");
  const tCompliance = useTranslations("vsCompliance");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => vsMembersQueryFromSearchParams(searchParams), [searchParams]);

  const [searchInput, setSearchInput] = useState(query.q);
  const [appliedQ, setAppliedQ] = useState(query.q);
  if (appliedQ !== query.q) {
    setAppliedQ(query.q);
    setSearchInput(query.q);
  }
  const [data, setData] = useState<VsMemberWeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"load" | "forbidden" | null>(null);
  const requestSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceQuery = useCallback(
    (next: Partial<VsMembersViewQuery>, resetPage = true) => {
      const merged = { ...query, ...next };
      if (resetPage) merged.page = 1;
      const params = vsMembersQueryToSearchParams(merged, new URLSearchParams(searchParams.toString()));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [query, searchParams, router, pathname],
  );

  const onSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => replaceQuery({ q: value }), 250);
    },
    [replaceQuery],
  );

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vs-performance/members?${vsMembersQueryToApiParams(query, weekStart)}`);
      if (seq !== requestSeq.current) return;
      if (res.status === 403) {
        setError("forbidden");
        return;
      }
      if (!res.ok) {
        setError("load");
        return;
      }
      const body = (await res.json()) as VsMemberWeekResponse;
      setData(body);
    } catch {
      if (seq === requestSeq.current) setError("load");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [query, weekStart]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const onSort = useCallback(
    (sort: VsMembersViewQuery["sort"]) => {
      const direction =
        query.sort === sort
          ? (query.direction ?? defaultSortDirection(sort)) === "asc"
            ? "desc"
            : "asc"
          : defaultSortDirection(sort);
      replaceQuery({ sort, direction });
    },
    [query, replaceQuery],
  );

  const intl = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const filtersActive = vsMembersFiltersActive(query);
  const range = data ? vsMembersPageRange(data.total, data.page, data.pageSize) : { start: 0, end: 0 };
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const policyKey = data ? vsMemberPolicyLineKey(data.policy) : null;
  const sourceKey = data ? vsMemberSourceKey(data.source) : null;

  const attentionGroups = data
    ? ([
        { id: "minimumsMissed", group: data.attention.minimumsMissed, filter: null },
        { id: "below", group: data.attention.below, filter: { status: "below" } },
        { id: "zero", group: data.attention.zero, filter: { status: "zero" } },
        { id: "needsEvidence", group: data.attention.needsEvidence, filter: { status: "needs_evidence" } },
        { id: "promotionPotential", group: data.attention.promotion, filter: { signal: "promotion" } },
      ] as const)
    : [];

  return (
    <section aria-labelledby="vs-members-heading" className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4" data-testid="vs-members-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="vs-members-heading" className="text-base font-semibold text-hq-fg">
          {t("title")}
        </h3>
        {data ? (
          <span className="rounded-full bg-hq-surface-muted px-2.5 py-0.5 text-xs font-medium text-hq-fg-muted">
            {data.live ? t("inProgress") : t("closed")}
          </span>
        ) : null}
      </div>

      {data ? (
        <div className="space-y-1 text-xs text-hq-fg-muted">
          <p>
            {policyKey === "policyLine"
              ? t("policyLine", {
                  minimum: data.policy.dailyThreshold !== null ? intl.format(data.policy.dailyThreshold) : "—",
                  allowed: data.policy.allowedMissedDays ?? 0,
                })
              : t(policyKey ?? "noPolicy")}
          </p>
          {data.live ? <p>{t("provisionalHint")}</p> : null}
          <p>{t("missingHint")}</p>
          {sourceKey === "sourceChecked" && data.source.verifiedAt ? (
            <p>{t("sourceChecked", { time: dateTimeFmt.format(new Date(data.source.verifiedAt)) })}</p>
          ) : null}
          {sourceKey === "sourceStale" ? <p role="status">{t("sourceStale")}</p> : null}
          {data.outstanding.count > 0 ? (
            <p>
              <Link href="/vs-compliance" className="text-hq-accent hover:underline">
                {t("outstanding")} ({intl.format(data.outstanding.count)})
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {data ? (
        <div className="flex flex-wrap gap-2 text-xs" data-testid="vs-members-summary">
          {([
            ["summaryMembers", data.summary.members],
            ["meeting", data.summary.meeting],
            ["below", data.summary.below],
            ["zero", data.summary.zero],
            ["excused", data.summary.excused],
            ["needsEvidence", data.summary.needsEvidence],
          ] as const).map(([key, count]) => (
            <span key={key} className="rounded-full border border-hq-border px-2.5 py-1 text-hq-fg-muted">
              {t(key)} · {intl.format(count)}
            </span>
          ))}
        </div>
      ) : null}

      {data && attentionGroups.some(({ group }) => group.total > 0) ? (
        <div className="space-y-2 rounded-lg border border-hq-border bg-hq-surface-muted/40 p-3" data-testid="vs-members-attention">
          <h4 className="text-xs font-semibold text-hq-fg">{t("attentionTitle")}</h4>
          {attentionGroups.map(({ id, group, filter }) =>
            group.total > 0 ? (
              <div key={id} className="text-xs">
                {filter ? (
                  <button
                    type="button"
                    onClick={() => replaceQuery(filter as Partial<VsMembersViewQuery>)}
                    className="font-medium text-hq-accent hover:underline"
                  >
                    {t(id)}
                  </button>
                ) : (
                  <span className="font-medium text-hq-fg">{t(id)}</span>
                )}
                <span className="text-hq-fg-muted">
                  {" — "}
                  {group.members.map((member) => member.name).join(", ")}
                  {group.total > group.members.length
                    ? ` ${t("more", { count: group.total - group.members.length })}`
                    : ""}
                </span>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2" data-testid="vs-members-filters">
        <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
          {t("search")}
          <input
            type="search"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("search")}
            className={inputCls}
            aria-label={t("search")}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
          {t("status")}
          <AppSelect
            value={query.status}
            onChange={(value) => replaceQuery({ status: value as VsMembersViewQuery["status"] })}
            aria-label={t("status")}
            options={[
              { value: "all", label: t("all") },
              ...VS_MEMBER_STATUSES.map((status) => ({
                value: status,
                label: t(VS_MEMBER_STATUS_KEYS[status]),
              })),
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
          {t("rank")}
          <AppSelect
            value={query.rank}
            onChange={(value) => replaceQuery({ rank: value as VsMembersViewQuery["rank"] })}
            aria-label={t("rank")}
            options={[
              { value: "all", label: t("all") },
              ...[1, 2, 3, 4, 5].map((rank) => ({
                value: String(rank),
                label: t("rankLabel", { rank }),
              })),
              { value: "unknown", label: t("rankUnknown") },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
          {t("excusal")}
          <AppSelect
            value={query.excusal}
            onChange={(value) => replaceQuery({ excusal: value as VsMembersViewQuery["excusal"] })}
            aria-label={t("excusal")}
            options={[
              { value: "all", label: t("all") },
              { value: "none", label: t("notExcused") },
              { value: "partial", label: t("partlyExcused") },
              { value: "full", label: t("excused") },
              { value: "pending", label: t("pendingExcusal") },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
          {t("signal")}
          <AppSelect
            value={query.signal}
            onChange={(value) => replaceQuery({ signal: value as VsMembersViewQuery["signal"] })}
            aria-label={t("signal")}
            options={[
              { value: "all", label: t("all") },
              ...VS_MEMBER_SIGNALS.map((signal) => ({
                value: signal,
                label:
                  signal === "leadership_review"
                    ? tCompliance("leadershipReview")
                    : t(VS_MEMBER_SIGNAL_KEYS[signal]),
              })),
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-hq-fg-muted">
          {t("sortBy")}
          <AppSelect
            value={["attention", "total", "name", "rank"].includes(query.sort) ? query.sort : "attention"}
            onChange={(value) => replaceQuery({ sort: value as VsMembersViewQuery["sort"], direction: null })}
            aria-label={t("sortBy")}
            options={[
              { value: "attention", label: t("attentionFirst") },
              { value: "total", label: t("sortTotal") },
              { value: "name", label: t("sortName") },
              { value: "rank", label: t("rank") },
            ]}
          />
        </label>
        {filtersActive ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => replaceQuery({ q: "", status: "all", rank: "all", excusal: "all", signal: "all" })}
          >
            {t("clearFilters")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-hq-border bg-hq-surface p-5" role="alert">
          <p className="text-sm text-hq-danger">{tErrors(error === "forbidden" ? "forbidden" : "load")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {tActions("retry")}
          </Button>
        </div>
      ) : loading && !data ? (
        <p role="status" className="py-6 text-center text-sm text-hq-fg-muted">
          {tActions("loading")}
        </p>
      ) : data ? (
        <>
          <div className={loading ? "opacity-60" : undefined}>
            <VsMemberTable
              rows={data.rows}
              sort={query.sort}
              direction={query.direction ?? defaultSortDirection(query.sort)}
              onSort={(key) => onSort(key)}
              emptyLabel={filtersActive ? t("noMatches") : t("empty")}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-hq-fg-muted">
            <span data-testid="vs-members-showing">
              {t("showing", {
                start: intl.format(range.start),
                end: intl.format(range.end),
                total: intl.format(data.total),
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={query.page <= 1}
                onClick={() => replaceQuery({ page: query.page - 1 }, false)}
              >
                {t("previousPage")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={query.page >= pageCount}
                onClick={() => replaceQuery({ page: query.page + 1 }, false)}
              >
                {t("nextPage")}
              </Button>
              <label className="flex items-center gap-1">
                {t("pageSize")}
                <AppSelect
                  value={String(query.pageSize)}
                  onChange={(value) => replaceQuery({ pageSize: Number(value) as 50 | 100 })}
                  aria-label={t("pageSize")}
                  options={[
                    { value: "50", label: "50" },
                    { value: "100", label: "100" },
                  ]}
                />
              </label>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
