import { getLocale } from "next-intl/server";
import { eq } from "drizzle-orm";

import { MemberLinkOnboardingWizard } from "@/components/onboarding/MemberLinkOnboardingWizard";
import { redirect } from "@/i18n/navigation";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import { getDb, schema } from "@/lib/db";
import { getWebMemberLinkStatus } from "@/lib/member-link/orchestrator.server";
import { resolveMemberLinkOnboardingInitialState } from "@/lib/member-link/onboarding-bootstrap.shared";
import { sessionHasHqMemberLink } from "@/lib/member-link/repository.server";
import {
  DEFAULT_POST_INVITE_APP_PATH,
  sanitizeInternalRedirectPath,
} from "@/lib/navigation/safe-redirect.shared";
import {
  getPageSessionState,
  loadSession,
  resolveEffectiveHqUserIdForSession,
  requirePageSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ next?: string; source?: string }>;
};

export default async function OnboardPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { next, source } = await searchParams;
  const nextPath =
    sanitizeInternalRedirectPath(next) ?? DEFAULT_POST_INVITE_APP_PATH;

  await requireAuthForPage("/onboard");

  const session = await requirePageSession("/onboard");
  const state = await getPageSessionState("/onboard", locale);

  if (!state.hasAppAccess) {
    redirect({ href: "/get-started", locale });
  }

  const freshSession = (await loadSession(session.id)) ?? session;
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    freshSession.id,
    freshSession.hqUserId,
  );
  const resolvedAllianceId =
    freshSession.currentAllianceId ?? freshSession.allianceId ?? null;

  if (!resolvedAllianceId) {
    redirect({ href: "/get-started", locale });
  }

  const allianceId = resolvedAllianceId!;

  const db = getDb();
  const [alliance] = await db
    .select({ name: schema.alliances.name, tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!alliance) {
    redirect({ href: "/get-started", locale });
  }

  const allianceName = alliance.name;
  const allianceTag = alliance.tag ?? alliance.name;

  if (effectiveHqUserId) {
    const linked = await sessionHasHqMemberLink(allianceId, effectiveHqUserId);
    if (linked) {
      redirect({ href: nextPath, locale });
    }
  }

  const initialOnboardingState = effectiveHqUserId
    ? resolveMemberLinkOnboardingInitialState(
        await getWebMemberLinkStatus({
          sessionId: freshSession.id,
          allianceId,
          hqUserId: effectiveHqUserId,
          locale,
        }),
      )
    : { phase: "welcome" as const };

  return (
    <MemberLinkOnboardingWizard
      allianceName={allianceName}
      allianceTag={allianceTag}
      nextPath={nextPath}
      successPresentation={source === "discord" ? "explore" : "default"}
      initialState={initialOnboardingState}
    />
  );
}
