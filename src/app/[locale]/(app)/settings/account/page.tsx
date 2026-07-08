import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { AccountChangeEmailCard } from "@/components/auth/AccountChangeEmailCard";
import { AccountConsolidateCard } from "@/components/auth/AccountConsolidateCard";
import { AccountPasskeysCard } from "@/components/auth/AccountPasskeysCard";
import { AccountPasswordCard } from "@/components/auth/AccountPasswordCard";
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
  searchParams: Promise<{ linked?: string; linkError?: string }>;
}) {
  const { locale } = await params;
  const { linked, linkError } = await searchParams;
  await requirePageSession("/settings/account");

  const session = await requireAuthSession();
  if (!session?.user?.email) {
    redirect({ href: "/auth?callbackUrl=/settings/account", locale });
    return null;
  }

  const t = await getTranslations({ locale, namespace: "accountSecurity" });
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
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-6">
          <AccountChangeEmailCard initialEmail={signInSnapshot.email} />
          <AccountConsolidateCard />
          <AccountPasswordCard hasPassword={hasPassword} />
          <AccountPasskeysCard passkeyCount={passkeys.length} />
        </div>
        <div className="min-w-0 w-full lg:max-w-md lg:justify-self-end">
          <AccountSignInMethodsClient
            initialSnapshot={initialSignInMethods}
            linkNotice={linkNotice}
            linkError={linkError?.trim() || null}
          />
        </div>
      </div>
    </div>
  );
}
