import { eq } from "drizzle-orm";

import { AccountSecurityClient } from "@/components/auth/AccountSecurityClient";
import { requireAuthSession } from "@/lib/auth";
import { hqUserHasPassword } from "@/lib/auth/password.server";
import { getDb, schema } from "@/lib/db";
import { redirect } from "@/i18n/navigation";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePageSession("/settings/account");

  const session = await requireAuthSession();
  if (!session?.user?.email) {
    redirect({ href: "/auth?callbackUrl=/settings/account", locale });
    return null;
  }

  const hqUserId = session.user.id;
  const hasPassword = await hqUserHasPassword(hqUserId);

  const db = getDb();
  const passkeys = await db
    .select({ credentialID: schema.hqAuthenticators.credentialID })
    .from(schema.hqAuthenticators)
    .where(eq(schema.hqAuthenticators.hqUserId, hqUserId));

  return (
    <AccountSecurityClient
      hasPassword={hasPassword}
      passkeyCount={passkeys.length}
    />
  );
}
