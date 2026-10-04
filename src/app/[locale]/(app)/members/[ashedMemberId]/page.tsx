import { getTranslations } from "next-intl/server";
import { readSessionId } from "@/lib/session";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { notFound, redirect } from "next/navigation";

import { CommanderProfileView } from "@/components/members/CommanderProfileView";
import { CommanderAccessError } from "@/lib/members/commander-access.server";
import { loadCommanderProfile } from "@/lib/members/commander-profile.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ ashedMemberId: string }>;
  searchParams: Promise<{ donationLaunchError?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations("members.profile");
  const { ashedMemberId } = await params;
  const trimmedId = ashedMemberId.trim();
  let pageTitle = t("titleWithId");
  const sessionId = await readSessionId();
  if (sessionId) {
    try {
      const profile = await loadCommanderProfile(sessionId, trimmedId);
      if (profile?.member.currentName?.trim()) {
        pageTitle = profile.member.currentName.trim();
      }
    } catch {
      // Fall back to generic commander profile title.
    }
  }
  return await allianceScopedMetadata(pageTitle);
}

export default async function CommanderProfilePage({ params, searchParams }: Props) {
  const session = await requirePageSession("/members");
  await requirePagePermission(session.id, "members:read", "/members");

  const { ashedMemberId } = await params;
  const sp = await searchParams;
  const donationLaunchError = sp.donationLaunchError?.trim() || undefined;
  let profile;
  try {
    profile = await loadCommanderProfile(session.id, ashedMemberId.trim());
  } catch (error) {
    if (error instanceof CommanderAccessError && error.status === 403) {
      redirect("/members");
    }
    throw error;
  }
  if (!profile) {
    notFound();
  }
  return (
    <CommanderProfileView
      initial={profile}
      donationLaunchError={donationLaunchError}
    />
  );
}
