import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { CommanderProfileView } from "@/components/members/CommanderProfileView";
import { CommanderAccessError } from "@/lib/members/commander-access.server";
import { loadCommanderProfile } from "@/lib/members/commander-profile.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ ashedMemberId: string }>;
};

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations("members.profile");
  const { ashedMemberId } = await params;
  return { title: t("titleWithId", { id: ashedMemberId }) };
}

export default async function CommanderProfilePage({ params }: Props) {
  const session = await requirePageSession("/members");
  await requirePagePermission(session.id, "members:read", "/members");

  const { ashedMemberId } = await params;
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
  return <CommanderProfileView initial={profile} />;
}
