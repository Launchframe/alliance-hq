"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { ActivityItem } from "@/components/activity/ActivityItem";
import { ActivityLookupSelect } from "@/components/activity/ActivityLookupSelect";
import {
  useActivityFeed,
  type ActivityFeedError,
  type ActivityLookupField,
} from "@/components/activity/useActivityFeed";
import { useAccountTimezoneLabel } from "@/components/timezone/TimezoneProvider";
import { AppSelect } from "@/components/ui/AppSelect";
import {
  ACTIVITY_FEATURE_LABEL_KEYS,
  activityActorKeyIsSensitive,
  activityVisibleServerNumber,
  activityVisibleText,
} from "@/lib/activity/presentation.shared";
import type {
  ActivityFeedOptionsResponse,
  ActivityFeedPage,
  ActivityFeedScope,
} from "@/lib/activity/feed.shared";
import {
  ACTIVITY_CHANNELS,
  ACTIVITY_KINDS,
} from "@/lib/activity/types.shared";

const buttonClass =
  "rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-surface-muted disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "mb-1 block text-xs text-hq-fg-subtle";
const dateInputClass =
  "w-full min-w-0 max-w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function ActivityFeed({
  scope,
  scopeFence,
  allowedScopes,
  initial,
  initialOptions,
  initialError,
}: {
  scope: ActivityFeedScope;
  scopeFence: string;
  allowedScopes: ActivityFeedScope[];
  initial: ActivityFeedPage | null;
  initialOptions: ActivityFeedOptionsResponse | null;
  initialError: ActivityFeedError | null;
}) {
  const t = useTranslations("activity");
  const tAll = useTranslations();
  const zoneLabel = useAccountTimezoneLabel();
  const feed = useActivityFeed({
    scope,
    scopeFence,
    allowedScopes,
    initial,
    initialOptions,
    initialError,
  });

  const channelOptions = useMemo(
    () => [
      { value: "", label: t("filters.all") },
      ...(feed.options?.channels ?? ACTIVITY_CHANNELS).map((channel) => ({
        value: channel,
        label: t(`channel.${channel}`),
      })),
    ],
    [feed.options?.channels, t],
  );

  const kindOptions = useMemo(
    () => [
      { value: "", label: t("filters.all") },
      ...(feed.options?.kinds ?? ACTIVITY_KINDS).map((kind) => ({
        value: kind,
        label: t(`kind.${kind}`),
      })),
    ],
    [feed.options?.kinds, t],
  );

  const categoryOptions = useMemo(
    () => [
      { value: "", label: t("filters.all") },
      ...(feed.options?.categories ?? [])
        .filter(
          (feature): feature is keyof typeof ACTIVITY_FEATURE_LABEL_KEYS =>
            feature in ACTIVITY_FEATURE_LABEL_KEYS,
        )
        .map((feature) => ({
          value: feature,
          label: tAll(ACTIVITY_FEATURE_LABEL_KEYS[feature]),
        })),
    ],
    [feed.options?.categories, t, tAll],
  );

  const actorOptions = useMemo(
    () => [
      { value: "", label: t("filters.all") },
      ...feed.lookupOptions.actor.flatMap((actor) => {
        if (activityActorKeyIsSensitive(actor.value)) return [];
        return [
          {
            value: actor.value,
            label: activityVisibleText(actor.label) ?? t("unknownActor"),
          },
        ];
      }),
    ],
    [feed.lookupOptions.actor, t],
  );

  const allianceOptions = useMemo(
    () => [
      { value: "", label: t("filters.all") },
      ...feed.lookupOptions.alliance.map((alliance) => {
        const tag = activityVisibleText(alliance.tag);
        const name = activityVisibleText(alliance.name);
        const parts = [
          activityVisibleServerNumber(alliance.serverNumber),
          tag ? `[${tag}]` : null,
          name,
        ].filter((part): part is string => part !== null);
        return {
          value: alliance.id,
          label: parts.length > 0 ? parts.join(" ") : t("filters.alliance"),
        };
      }),
    ],
    [feed.lookupOptions.alliance, t],
  );

  const serverOptions = useMemo(
    () => [
      { value: "", label: t("filters.all") },
      ...feed.lookupOptions.server.map((server) => ({
        value: server,
        label: server,
      })),
    ],
    [feed.lookupOptions.server, t],
  );

  const alertRef = useRef<HTMLDivElement | null>(null);
  const lastAlertTickRef = useRef(0);
  useEffect(() => {
    if (feed.alertTick === lastAlertTickRef.current) return;
    lastAlertTickRef.current = feed.alertTick;
    alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [feed.alertTick]);

  const searchLookup = feed.searchLookup;
  const onActorSearch = useCallback(
    (query: string) => searchLookup("actor", query),
    [searchLookup],
  );
  const onAllianceSearch = useCallback(
    (query: string) => searchLookup("alliance", query),
    [searchLookup],
  );
  const onServerSearch = useCallback(
    (query: string) => searchLookup("server", query),
    [searchLookup],
  );
  const lookupSearches: Record<
    ActivityLookupField,
    (query: string) => void
  > = {
    actor: onActorSearch,
    alliance: onAllianceSearch,
    server: onServerSearch,
  };

  const accessChanged = feed.error === "accessChanged";
  const showActorFilter = scope !== "personal";
  const showAllianceFilter = scope !== "alliance";
  const showServerFilter = scope === "global";
  const displayScopes = feed.allowedScopes;

  if (feed.blocked) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-6 text-sm text-hq-fg-muted">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>

      {!accessChanged && displayScopes.length > 1 ? (
        <nav
          aria-label={t("title")}
          className="mt-3 flex min-w-0 gap-1 overflow-x-auto border-b border-hq-border"
        >
          {displayScopes.map((entry) => (
            <Link
              key={entry}
              href={`/activity?scope=${entry}`}
              aria-current={entry === scope ? "page" : undefined}
              className={cn(
                "shrink-0 px-3 py-2 text-sm",
                entry === scope
                  ? "-mb-px border-b-2 border-hq-accent font-medium text-hq-fg"
                  : "text-hq-fg-muted hover:text-hq-fg",
              )}
            >
              {t(`tabs.${entry}`)}
            </Link>
          ))}
        </nav>
      ) : null}

      <p className="mt-3 text-xs text-hq-fg-muted">{t("historyNotice")}</p>

      {accessChanged ? (
        <div
          ref={alertRef}
          role="alert"
          className="mt-4 rounded-lg border border-hq-border bg-hq-surface p-4"
        >
          <p className="text-sm text-hq-fg">{t("accessChanged")}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={cn(buttonClass, "mt-2")}
          >
            {t("refresh")}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <div>
              <span className={labelClass}>{t("filters.channel")}</span>
              <AppSelect
                value={feed.filters.channel}
                onChange={(value) => feed.setFilter({ channel: value })}
                options={channelOptions}
                aria-label={t("filters.channel")}
              />
            </div>
            <div>
              <span className={labelClass}>{t("filters.kind")}</span>
              <AppSelect
                value={feed.filters.kind}
                onChange={(value) => feed.setFilter({ kind: value })}
                options={kindOptions}
                aria-label={t("filters.kind")}
              />
            </div>
            <div>
              <span className={labelClass}>{t("filters.category")}</span>
              <AppSelect
                value={feed.filters.category}
                onChange={(value) => feed.setFilter({ category: value })}
                options={categoryOptions}
                aria-label={t("filters.category")}
              />
            </div>
            {showActorFilter ? (
              <div>
                <span className={labelClass}>{t("filters.user")}</span>
                <ActivityLookupSelect
                  ariaLabel={t("filters.user")}
                  value={feed.filters.actor}
                  onChange={(value) => feed.setFilter({ actor: value })}
                  options={actorOptions}
                  searchPlaceholder={t("filters.user")}
                  noSearchResultsLabel={t("noMatches")}
                  onSearchQuery={lookupSearches.actor}
                  hasError={feed.lookupError.actor}
                  errorSignal={feed.lookupAlert.actor}
                  onRetry={() => feed.retryLookup("actor")}
                  retryLabel={t("retry")}
                  loadFailedLabel={t("loadFailed")}
                />
              </div>
            ) : null}
            {showAllianceFilter ? (
              <div>
                <span className={labelClass}>{t("filters.alliance")}</span>
                <ActivityLookupSelect
                  ariaLabel={t("filters.alliance")}
                  value={feed.filters.allianceId}
                  onChange={(value) => feed.setFilter({ allianceId: value })}
                  options={allianceOptions}
                  searchPlaceholder={t("filters.alliance")}
                  noSearchResultsLabel={t("noMatches")}
                  onSearchQuery={lookupSearches.alliance}
                  hasError={feed.lookupError.alliance}
                  errorSignal={feed.lookupAlert.alliance}
                  onRetry={() => feed.retryLookup("alliance")}
                  retryLabel={t("retry")}
                  loadFailedLabel={t("loadFailed")}
                />
              </div>
            ) : null}
            {showServerFilter ? (
              <div>
                <span className={labelClass}>{t("filters.server")}</span>
                <ActivityLookupSelect
                  ariaLabel={t("filters.server")}
                  value={feed.filters.server}
                  onChange={(value) => feed.setFilter({ server: value })}
                  options={serverOptions}
                  searchPlaceholder={t("filters.server")}
                  noSearchResultsLabel={t("noMatches")}
                  onSearchQuery={lookupSearches.server}
                  hasError={feed.lookupError.server}
                  errorSignal={feed.lookupAlert.server}
                  onRetry={() => feed.retryLookup("server")}
                  retryLabel={t("retry")}
                  loadFailedLabel={t("loadFailed")}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor="activity-date-from" className={labelClass}>
                {t("filters.from")}
              </label>
              <input
                id="activity-date-from"
                type="date"
                value={feed.filters.dateFrom}
                onChange={(event) =>
                  feed.setFilter({ dateFrom: event.target.value })
                }
                className={dateInputClass}
              />
            </div>
            <div>
              <label htmlFor="activity-date-to" className={labelClass}>
                {t("filters.to")}
              </label>
              <input
                id="activity-date-to"
                type="date"
                value={feed.filters.dateTo}
                onChange={(event) =>
                  feed.setFilter({ dateTo: event.target.value })
                }
                className={dateInputClass}
              />
              <span className="mt-1 block text-[11px] text-hq-fg-subtle">
                {zoneLabel}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={feed.refresh}
              disabled={feed.busy !== null}
              className={buttonClass}
            >
              {t("refresh")}
            </button>
            <button
              type="button"
              onClick={feed.clearFilters}
              disabled={feed.busy !== null || !feed.filtersActive}
              className={buttonClass}
            >
              {t("filters.clear")}
            </button>
          </div>

          {feed.pendingNew ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-hq-border bg-hq-surface px-3 py-2">
              <p className="min-w-0 flex-1 text-sm text-hq-fg">{t("newActivity")}</p>
              <button
                type="button"
                onClick={feed.viewNew}
                className={buttonClass}
              >
                {t("viewNew")}
              </button>
            </div>
          ) : null}

          {feed.error === "loadFailed" &&
          feed.errorPlacement === "toolbar" ? (
            <div
              ref={alertRef}
              role="alert"
              className="mt-3 rounded-lg border border-hq-border bg-hq-surface p-3"
            >
              <p className="text-sm text-hq-fg">{t("loadFailed")}</p>
              <button
                type="button"
                onClick={feed.retry}
                className={cn(buttonClass, "mt-2")}
              >
                {t("retry")}
              </button>
            </div>
          ) : null}

          {feed.busy === "first" && feed.rows.length === 0 ? (
            <p className="mt-6 text-sm text-hq-fg-muted">{t("loading")}</p>
          ) : (
            <>
              {feed.rows.length === 0 &&
              feed.error === null &&
              feed.busy === null ? (
                <p className="mt-6 text-sm text-hq-fg-muted">
                  {feed.filtersActive ? t("noMatches") : t("empty")}
                </p>
              ) : null}
              {feed.rows.length > 0 ? (
                <ol className="mt-2 min-w-0">
                  {feed.rows.map((item) => (
                    <ActivityItem key={item.id} item={item} scope={scope} />
                  ))}
                </ol>
              ) : null}
              {feed.error === "loadFailed" &&
              feed.errorPlacement === "bottom" ? (
                <div
                  ref={alertRef}
                  role="alert"
                  className="mt-4 rounded-lg border border-hq-border bg-hq-surface p-3"
                >
                  <p className="text-sm text-hq-fg">{t("loadFailed")}</p>
                  <button
                    type="button"
                    onClick={feed.retry}
                    className={cn(buttonClass, "mt-2")}
                  >
                    {t("retry")}
                  </button>
                </div>
              ) : null}
              {feed.nextCursor ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={feed.loadMore}
                    disabled={feed.busy !== null}
                    className={buttonClass}
                  >
                    {t("loadMore")}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
