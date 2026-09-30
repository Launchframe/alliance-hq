import type { ActivityFeedItem, ActivityFeedScope } from "./feed.shared";
import type { ActivityRole, ActivityTool } from "./types.shared";

export const ACTIVITY_FEATURE_LABEL_KEYS = {
  thp: "nav.myThp",
  vr: "nav.viralResistance",
  kills: "nav.allianceKillsVideo",
  members: "nav.members",
  scores: "nav.vsPerformance",
  notes: "nav.notes",
  account: "nav.account",
  usage: "activity.kind.usage",
} as const;

export const ACTIVITY_TOOL_LABEL_KEYS: Record<ActivityTool, string> = {
  thp: "nav.myThp",
  vr: "nav.myVr",
  kills: "nav.myKills",
  trains: "nav.trains",
  members: "nav.members",
  vsPerformance: "nav.vsPerformance",
  banks: "nav.bankManagement",
  battlePlan: "nav.battlePlan",
  timeOff: "nav.timeOff",
  professions: "nav.myProfession",
  supportTeams: "nav.supportTeams",
  plunderPlan: "nav.plunderPlan",
  notes: "nav.notes",
} as const;

export const ACTIVITY_ROLE_LABEL_KEYS: Record<ActivityRole, string> = {
  owner: "team.invites.roleOwner",
  maintainer: "team.invites.roleMaintainer",
  officer: "team.invites.roleOfficer",
  data_entry: "team.invites.roleDataEntry",
  member: "team.invites.roleMember",
  viewer: "team.invites.roleViewer",
} as const;

export type ActivityTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** Names, tags, and labels. A game UID or email anywhere in the text is not shown. */
export function activityVisibleText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@") || /[0-9]{12,16}/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function activityVisibleServerNumber(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{1,8}$/.test(trimmed) ? trimmed : null;
}

/**
 * Actor option values are `hq:` / `discord:` keys. Drop a key whose id is itself
 * a game UID. Longer Discord snowflakes stay, because `{12,16}` would otherwise
 * match inside them.
 */
export function activityActorKeyIsSensitive(value: string): boolean {
  const trimmed = value.trim();
  const id = trimmed.replace(/^(hq|discord):/, "");
  if (id.includes("@") || /^\d{12,16}$/.test(id)) return true;
  if (/^(hq|discord):/.test(trimmed)) return false;
  return /[0-9]{12,16}/.test(trimmed);
}

export function formatActivityNumber(
  value: string | number,
  locale: string,
): string {
  return new Intl.NumberFormat(locale).format(
    typeof value === "string" ? BigInt(value) : value,
  );
}

function actorLabel(
  item: ActivityFeedItem,
  scope: ActivityFeedScope,
  t: ActivityTranslator,
): string {
  if (scope === "personal") {
    return t("activity.you");
  }
  const name =
    activityVisibleText(item.actor?.displayName) ?? t("activity.unknownActor");
  if (scope === "alliance") {
    return name;
  }
  const parts: string[] = [];
  if (item.alliance === null) {
    parts.push(t("activity.noAlliance"));
  } else {
    const server = activityVisibleServerNumber(item.alliance.serverNumber);
    const tag = activityVisibleText(item.alliance.tag);
    if (server) parts.push(server);
    if (tag) parts.push(`[${tag}]`);
  }
  parts.push(name);
  return parts.join(" ");
}

export function formatActivitySentence(
  item: ActivityFeedItem,
  scope: ActivityFeedScope,
  locale: string,
  t: ActivityTranslator,
): string {
  const values: Record<string, string | number> = {
    actor: actorLabel(item, scope, t),
  };
  if (item.values.value !== undefined) {
    values.value = formatActivityNumber(item.values.value, locale);
  }
  if (item.values.member !== undefined) {
    values.member =
      activityVisibleText(item.values.member) ?? t("activity.unknownActor");
  }
  if (item.values.fromRank !== undefined) {
    values.fromRank = item.values.fromRank;
  }
  if (item.values.toRank !== undefined) {
    values.toRank = item.values.toRank;
  }
  if (item.values.rank !== undefined) {
    values.rank = item.values.rank;
  }
  if (item.values.fromRole !== undefined) {
    values.fromRole = t(ACTIVITY_ROLE_LABEL_KEYS[item.values.fromRole]);
  }
  if (item.values.toRole !== undefined) {
    values.toRole = t(ACTIVITY_ROLE_LABEL_KEYS[item.values.toRole]);
  }
  if (item.resource !== null) {
    values.resource = t(`activity.resources.${item.resource}`);
  }
  if (item.values.tool !== undefined) {
    values.tool = t(ACTIVITY_TOOL_LABEL_KEYS[item.values.tool]);
  }
  return t(`activity.events.${item.descriptor}`, values);
}

export function activityDayStartIso(date: string, timeZone: string): string {
  const anchor = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date.startsWith("0000-") ||
    !Number.isFinite(anchor) ||
    new Date(anchor).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("invalid_activity_date");
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let low = anchor - 48 * 60 * 60 * 1000;
  let high = anchor + 48 * 60 * 60 * 1000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const parts = formatter.formatToParts(new Date(mid));
    const part = (kind: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === kind)!.value;
    const year =
      part("era") === "BC" ? 1 - Number(part("year")) : Number(part("year"));
    const localDate = `${String(year).padStart(4, "0")}-${part("month")}-${part("day")}`;
    if (localDate < date) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return new Date(low).toISOString();
}
