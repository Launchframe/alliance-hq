import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import {
  activityAllowedScopes,
  getActivityPrincipalForSession,
} from "@/lib/activity/access.server";
import {
  ACTIVITY_SCOPES,
  type ActivityFeedOptionsResponse,
  type ActivityFeedPage,
  type ActivityFeedScope,
} from "@/lib/activity/feed.shared";
import {
  queryActivityFilterOptions,
  queryActivityPage,
} from "@/lib/activity/query.server";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("activity");
  return await allianceScopedMetadata(t("title"));
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const session = await requirePageSession("/activity");
  const principal = await getActivityPrincipalForSession(session);
  if (!principal) {
    notFound();
  }

  const { scope: rawScope } = await searchParams;
  if (Array.isArray(rawScope)) {
    notFound();
  }
  const scope = (rawScope ?? "personal") as ActivityFeedScope;
  if (!ACTIVITY_SCOPES.includes(scope)) {
    notFound();
  }

  const t = await getTranslations("activity");
  if (scope === "alliance" && !principal.currentAllianceId) {
    return (
      <div className="px-4 py-6 md:px-0">
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-4 text-sm text-hq-fg-muted">{t("selectAlliance")}</p>
        <Link
          href="/activity"
          className="mt-2 inline-block text-sm text-hq-accent hover:underline"
        >
          {t("tabs.personal")}
        </Link>
      </div>
    );
  }

  const allowedScopes = activityAllowedScopes(principal);
  if (!allowedScopes.includes(scope)) {
    notFound();
  }

  let initial: ActivityFeedPage | null = null;
  let initialOptions: ActivityFeedOptionsResponse | null = null;
  let initialError: "loadFailed" | null = null;
  try {
    [initial, initialOptions] = await Promise.all([
      queryActivityPage(principal, scope, { view: "page", limit: 50 }),
      queryActivityFilterOptions(principal, scope, {
        view: "filters",
        limit: 50,
      }),
    ]);
  } catch {
    initialError = "loadFailed";
  }

  return (
    <div className="px-4 py-6 md:px-0">
      <ActivityFeed
        key={`${principal.scopeFence}:${scope}`}
        scope={scope}
        scopeFence={principal.scopeFence}
        allowedScopes={allowedScopes}
        initial={initial}
        initialOptions={initialOptions}
        initialError={initialError}
      />
    </div>
  );
}
