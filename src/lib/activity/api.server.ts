import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { routing } from "@/i18n/routing";
import { isAppLocale, LOCALE_COOKIE_NAME } from "@/lib/i18n/geo-locale.shared";

import { ActivityReadError, requireActivityPrincipal } from "./access.server";
import { activityCatalog } from "./catalog.shared";
import type { ActivityFeedScope } from "./feed.shared";
import {
  queryActivityFilterOptions,
  queryActivityHead,
  queryActivityPage,
  type ActivityFeedQueryInput,
} from "./query.server";
import {
  ACTIVITY_CHANNELS,
  ACTIVITY_KINDS,
  activityIdentifierSchema,
} from "./types.shared";

const ALLOWED_PARAMS = new Set([
  "from",
  "to",
  "channel",
  "category",
  "kind",
  "actor",
  "allianceId",
  "server",
  "limit",
  "cursor",
  "view",
  "q",
]);

const FEATURE_VALUES: ReadonlySet<string> = new Set(
  Object.values(activityCatalog).map((entry) => entry.feature),
);
const ACTOR_PATTERN = /^(hq|discord):[^\s@]{1,200}$/;
const SERVER_PATTERN = /^\d{1,8}$/;
const dateTimeSchema = z.iso.datetime({ offset: true });

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function invalid(): ActivityReadError {
  return new ActivityReadError("invalid", 400);
}

function epochMicros(value: string): bigint {
  const fraction =
    value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * BigInt(1000) +
    BigInt(fraction.padEnd(6, "0").slice(3, 6))
  );
}

function parseDateParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value.length > 40 ||
    value.startsWith("0000-") ||
    /\.\d{7,}/.test(value) ||
    !dateTimeSchema.safeParse(value).success
  ) {
    throw invalid();
  }
  return value;
}

export function parseActivityFeedQuery(
  params: URLSearchParams,
  scope: ActivityFeedScope,
): ActivityFeedQueryInput {
  const seen = new Map<string, string>();
  for (const [key, value] of params) {
    if (!ALLOWED_PARAMS.has(key) || seen.has(key)) {
      throw invalid();
    }
    seen.set(key, value);
  }

  const view = seen.get("view") ?? "page";
  if (view !== "page" && view !== "head" && view !== "filters") {
    throw invalid();
  }

  let limit = 50;
  const rawLimit = seen.get("limit");
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit)) {
      throw invalid();
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw invalid();
    }
  }

  const cursor = seen.get("cursor");
  if (
    cursor !== undefined &&
    (view !== "page" || cursor.length === 0 || cursor.length > 1600)
  ) {
    throw invalid();
  }

  let q: string | undefined;
  const rawQ = seen.get("q");
  if (rawQ !== undefined) {
    if (view !== "filters") {
      throw invalid();
    }
    const trimmed = rawQ.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      throw invalid();
    }
    q = trimmed;
  }

  const from = parseDateParam(seen.get("from"));
  const to = parseDateParam(seen.get("to"));
  if (
    from !== undefined &&
    to !== undefined &&
    epochMicros(from) >= epochMicros(to)
  ) {
    throw invalid();
  }

  const channel = seen.get("channel");
  if (
    channel !== undefined &&
    !(ACTIVITY_CHANNELS as readonly string[]).includes(channel)
  ) {
    throw invalid();
  }

  const kind = seen.get("kind");
  if (
    kind !== undefined &&
    !(ACTIVITY_KINDS as readonly string[]).includes(kind)
  ) {
    throw invalid();
  }

  const category = seen.get("category");
  if (category !== undefined && !FEATURE_VALUES.has(category)) {
    throw invalid();
  }

  const actor = seen.get("actor");
  if (actor !== undefined && (scope === "personal" || !ACTOR_PATTERN.test(actor))) {
    throw invalid();
  }

  const allianceId = seen.get("allianceId");
  if (
    allianceId !== undefined &&
    (scope === "alliance" || !activityIdentifierSchema.safeParse(allianceId).success)
  ) {
    throw invalid();
  }

  const server = seen.get("server");
  if (server !== undefined && (scope !== "global" || !SERVER_PATTERN.test(server))) {
    throw invalid();
  }

  return {
    view,
    limit,
    cursor,
    q,
    from,
    to,
    channel: channel as ActivityFeedQueryInput["channel"],
    category,
    kind: kind as ActivityFeedQueryInput["kind"],
    actor,
    allianceId,
    server,
  };
}

export async function handleActivityRead(
  request: Request,
  scope: ActivityFeedScope,
): Promise<NextResponse> {
  try {
    const principal = await requireActivityPrincipal(scope);
    const query = parseActivityFeedQuery(
      new URL(request.url).searchParams,
      scope,
    );
    const body =
      query.view === "head"
        ? await queryActivityHead(principal, scope, query)
        : query.view === "filters"
          ? await queryActivityFilterOptions(principal, scope, query)
          : await queryActivityPage(principal, scope, query);
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    return activityErrorResponse(request, scope, error);
  }
}

async function activityErrorResponse(
  request: Request,
  scope: ActivityFeedScope,
  error: unknown,
): Promise<NextResponse> {
  const isReadError = error instanceof ActivityReadError;
  const status = isReadError ? error.status : 500;
  const code = isReadError ? error.code : "internal";
  if (status >= 500) {
    console.error(JSON.stringify({ signal: "activity_read_failed", scope }));
  }
  const requestedLocale =
    request.headers.get("x-activity-locale") ??
    (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
  const locale = isAppLocale(requestedLocale)
    ? requestedLocale
    : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "activity" });
  const denied = code === "unauthorized" || code === "forbidden";
  return NextResponse.json(
    {
      error: denied ? t("accessChanged") : t("loadFailed"),
      errorKey: denied ? "activity.accessChanged" : "activity.loadFailed",
      code,
    },
    { status, headers: NO_STORE },
  );
}
