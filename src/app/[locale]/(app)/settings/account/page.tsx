import { eq } from "drizzle-orm";

import { AccountSecurityClient } from "@/components/auth/AccountSecurityClient";
import { AccountSignInMethodsClient } from "@/components/auth/AccountSignInMethodsClient";
import { redirect } from "@/i18n/navigation";
import { requireAuthSession } from "@/lib/auth";
import { loadSignInMethodSnapshot } from "@/lib/auth/account-linking.server";
import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import { hqUserHasPassword } from "@/lib/auth/password.server";
import { getAuthSsoAvailability } from "@/lib/auth/sso-config.server";
import { getDb, schema } from "@/lib/db";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ linked?: string }>;
}) {
  const { locale } = await params;
  const { linked } = await searchParams;
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

  const signInSnapshot = await loadSignInMethodSnapshot(hqUserId);
  const ssoAvailability = getAuthSsoAvailability();
  const linkNotice =
    linked === "google" || linked === "discord"
      ? (linked as LinkedOAuthProvider)
      : null;

  if (!signInSnapshot) {
    redirect({ href: "/auth?callbackUrl=/settings/account", locale });
    return null;
  }

  const initialSignInMethods = {
    email: signInSnapshot.email,
    hasPassword: signInSnapshot.hasPassword,
    passkeyCount: signInSnapshot.passkeyCount,
    linkedProviders: signInSnapshot.linkedProviders,
    availableProviders: {
      google: ssoAvailability.google,
      discord: ssoAvailability.discord,
    },
  };

  return (
    <div className="space-y-6">
      <AccountSignInMethodsClient
        initialSnapshot={initialSignInMethods}
        linkNotice={linkNotice}
      />
      <AccountSecurityClient
        hasPassword={hasPassword}
        passkeyCount={passkeys.length}
      />
    </div>
  );
}
