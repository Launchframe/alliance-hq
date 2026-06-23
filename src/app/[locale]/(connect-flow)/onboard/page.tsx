import { getLocale } from "next-intl/server";
import { eq } from "drizzle-orm";

import { MemberLinkOnboardingWizard } from "@/components/onboarding/MemberLinkOnboardingWizard";
import { redirect } from "@/i18n/navigation";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import { getDb, schema } from "@/lib/db";
import { sessionHasHqMemberLink } from "@/lib/member-link/repository.server";
import {
  DEFAULT_POST_INVITE_APP_PATH,
  sanitizeInternalRedirectPath,
} from "@/lib/navigation/safe-redirect.shared";
import { rethrowNavigationError } from "@/lib/navigation";
import {
  getPageSessionState,
  resolveEffectiveHqUserIdForSession,
  requirePageSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function OnboardPage({ searchParams }: Props) {
  const locale = await getLocale();
  const { next } = await searchParams;
  const nextPath =
    sanitizeInternalRedirectPath(next) ?? DEFAULT_POST_INVITE_APP_PATH;

  let allianceName = "";
  let allianceTag = "";

  try {
    await requireAuthForPage("/onboard");
    const session = await requirePageSession("/onboard");
    const state = await getPageSessionState("/onboard", locale);

    if (!state.hasAppAccess) {
      redirect({ href: "/get-started", locale });
    }

    const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
      session.id,
      session.hqUserId,
    );
    const resolvedAllianceId =
      session.currentAllianceId ?? session.allianceId ?? null;

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

    allianceName = alliance.name;
    allianceTag = alliance.tag ?? alliance.name;

    if (effectiveHqUserId) {
      const linked = await sessionHasHqMemberLink(
        allianceId,
        effectiveHqUserId,
      );
      if (linked) {
        redirect({ href: nextPath, locale });
      }
    }
  } catch (error) {
    rethrowNavigationError(error);
    throw error;
  }

  return (
    <MemberLinkOnboardingWizard
      allianceName={allianceName}
      allianceTag={allianceTag}
      nextPath={nextPath}
    />
  );
}
