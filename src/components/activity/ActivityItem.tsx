"use client";

import { useLocale, useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import {
  ACTIVITY_FEATURE_LABEL_KEYS,
  ACTIVITY_ROLE_LABEL_KEYS,
  formatActivityNumber,
  formatActivitySentence,
} from "@/lib/activity/presentation.shared";
import type {
  ActivityFeedItem,
  ActivityFeedScope,
} from "@/lib/activity/feed.shared";

const pillClass =
  "inline-flex items-center rounded-full border border-hq-border bg-hq-surface-muted px-2 py-0.5 text-[11px] font-medium text-hq-fg-muted";

function FeatureBadge({ feature }: { feature: string }) {
  const t = useTranslations();
  const labelKey =
    ACTIVITY_FEATURE_LABEL_KEYS[
      feature as keyof typeof ACTIVITY_FEATURE_LABEL_KEYS
    ];
  if (!labelKey) return null;
  return <span className={pillClass}>{t(labelKey)}</span>;
}

export function ActivityItem({
  item,
  scope,
}: {
  item: ActivityFeedItem;
  scope: ActivityFeedScope;
}) {
  const t = useTranslations("activity");
  const tAll = useTranslations();
  const locale = useLocale();
  const formatDateTime = useFormatAccountDateTime();

  const sentence = formatActivitySentence(item, scope, locale, tAll);
  const showActorBadges = scope !== "personal" && item.actor !== null;
  const roleLabelKey = item.actor?.hqRole
    ? ACTIVITY_ROLE_LABEL_KEYS[item.actor.hqRole]
    : null;

  const hasBefore =
    item.details.previousValue != null && item.values.value !== undefined;
  const hasAfter = item.values.value !== undefined && hasBefore;
  const hasAffected = item.details.affected !== undefined;
  const hasCompleted = item.details.completed !== undefined;
  const hasDetails =
    hasBefore || hasAfter || hasAffected || hasCompleted;

  return (
    <li
      data-testid={`activity-item-${item.id}`}
      className="border-b border-hq-border py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 break-words text-sm text-hq-fg">
          {sentence}
        </p>
        <time
          dateTime={item.occurredAt}
          className="shrink-0 text-xs text-hq-fg-subtle"
        >
          {formatDateTime(item.occurredAt)}
        </time>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={pillClass}>
          {item.channel
            ? t(`channel.${item.channel}`)
            : t("unknownChannel")}
        </span>
        {item.method ? (
          <span className={pillClass}>{t(`method.${item.method}`)}</span>
        ) : null}
        <FeatureBadge feature={item.feature} />
        {showActorBadges && roleLabelKey ? (
          <span className={pillClass} title={t("details.role")}>
            {tAll(roleLabelKey)}
          </span>
        ) : null}
        {showActorBadges && item.actor?.gameRank ? (
          <span className={pillClass} title={t("details.rank")}>
            {item.actor.gameRank}
          </span>
        ) : null}
        {showActorBadges && item.actor?.unlinkedHq ? (
          <span className={pillClass}>{t("unlinkedHq")}</span>
        ) : null}
        {item.historical ? (
          <span className={pillClass}>{t("historical")}</span>
        ) : null}
      </div>
      {hasDetails ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-hq-fg-muted hover:text-hq-fg">
            {t("viewDetails")}
          </summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pl-4 text-xs">
            {hasBefore ? (
              <>
                <dt className="text-hq-fg-subtle">{t("details.before")}</dt>
                <dd className="text-hq-fg">
                  {formatActivityNumber(item.details.previousValue!, locale)}
                </dd>
                <dt className="text-hq-fg-subtle">{t("details.after")}</dt>
                <dd className="text-hq-fg">
                  {formatActivityNumber(item.values.value!, locale)}
                </dd>
              </>
            ) : null}
            {hasAffected ? (
              <>
                <dt className="text-hq-fg-subtle">
                  {t("details.affected")}
                </dt>
                <dd className="text-hq-fg">
                  {formatActivityNumber(item.details.affected!, locale)}
                </dd>
              </>
            ) : null}
            {hasCompleted ? (
              <>
                <dt className="text-hq-fg-subtle">
                  {t("details.succeeded")}
                </dt>
                <dd className="text-hq-fg">
                  {formatActivityNumber(item.details.completed!, locale)}
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      ) : null}
    </li>
  );
}
