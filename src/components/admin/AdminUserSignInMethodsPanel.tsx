"use client";

import { useTranslations } from "next-intl";

import { OAuthIdentitySplitBadge } from "@/components/auth/OAuthIdentitySplitBadge";
import type {
  LinkedOAuthProvider,
  OAuthProviderAccountSnapshot,
} from "@/lib/auth/account-linking.shared";
import type { OAuthIdentitySplitRow } from "@/lib/auth/oauth-identity-split.shared";

export type AdminUserSignInMethodsSnapshot = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
  oauthAccounts: OAuthProviderAccountSnapshot[];
  availableProviders: {
    google: boolean;
    discord: boolean;
  };
  oauthIdentitySplit: boolean;
  oauthIdentitySplits: OAuthIdentitySplitRow[];
};

type Props = {
  snapshot: AdminUserSignInMethodsSnapshot | null;
};

function oauthAccountForProvider(
  accounts: OAuthProviderAccountSnapshot[],
  provider: LinkedOAuthProvider,
): OAuthProviderAccountSnapshot | undefined {
  return accounts.find((row) => row.provider === provider);
}

export function AdminUserSignInMethodsPanel({ snapshot }: Props) {
  const t = useTranslations("admin.usersPage");
  const tSecurity = useTranslations("accountSecurity");

  if (!snapshot) {
    return (
      <section className="space-y-2">
        <h3 className="font-medium">{t("signInMethodsTitle")}</h3>
        <p className="text-sm text-hq-fg-muted">{t("signInMethodsUnavailable")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-medium">{t("signInMethodsTitle")}</h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("signInMethodsHint")}</p>
      </div>

      {snapshot.oauthIdentitySplit ? (
        <div
          className="space-y-2 rounded-lg border border-[#d29922]/40 bg-[#d29922]/10 px-3 py-2.5 text-sm"
          role="status"
        >
          <div className="flex flex-wrap items-center gap-2">
            <OAuthIdentitySplitBadge label={t("oauthSplitBadge")} />
            <p className="text-hq-fg">{t("oauthSplitAdminHint")}</p>
          </div>
          <ul className="space-y-1 text-xs text-hq-fg-muted">
            {snapshot.oauthIdentitySplits.map((split) => (
              <li key={`${split.ashedMemberId}:${split.discordUserId}`}>
                {t("oauthSplitAdminRow", {
                  alliance: split.allianceSlug,
                  oauthEmail: split.oauthHqUserEmail || t("oauthSplitUnknownEmail"),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="space-y-2 text-sm">
        <li className="flex flex-col gap-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-hq-fg">{tSecurity("methodEmailMagicLink")}</p>
            <p className="text-hq-fg-muted">{snapshot.email}</p>
          </div>
          <span className="text-xs text-hq-green">{tSecurity("methodAlwaysAvailable")}</span>
        </li>

        <li className="flex flex-col gap-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-hq-fg">{tSecurity("methodPassword")}</p>
            <p className="text-hq-fg-muted">
              {snapshot.hasPassword
                ? tSecurity("methodConnected")
                : tSecurity("methodNotSet")}
            </p>
          </div>
        </li>

        <li className="flex flex-col gap-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-hq-fg">{tSecurity("methodPasskey")}</p>
            <p className="text-hq-fg-muted">
              {snapshot.passkeyCount > 0
                ? tSecurity("passkeySectionBodyCount", {
                    count: snapshot.passkeyCount,
                  })
                : tSecurity("methodNotSet")}
            </p>
          </div>
        </li>

        {(["google", "discord"] as const).map((provider) => {
          if (!snapshot.availableProviders[provider]) {
            return null;
          }
          const account = oauthAccountForProvider(snapshot.oauthAccounts, provider);
          const isLinked = Boolean(account);
          return (
            <li
              key={provider}
              className="flex flex-col gap-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-hq-fg">
                  {provider === "google"
                    ? tSecurity("methodGoogle")
                    : tSecurity("methodDiscord")}
                </p>
                <p className="text-hq-fg-muted">
                  {isLinked
                    ? tSecurity("methodConnected")
                    : tSecurity("methodNotLinked")}
                </p>
                {account?.providerEmail ? (
                  <p className="mt-0.5 truncate text-xs text-hq-fg-muted">
                    {t("providerEmailLabel", { email: account.providerEmail })}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
