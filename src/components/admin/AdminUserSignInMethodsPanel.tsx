"use client";

import { useTranslations } from "next-intl";

import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";

export type AdminUserSignInMethodsSnapshot = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
  availableProviders: {
    google: boolean;
    discord: boolean;
  };
};

type Props = {
  snapshot: AdminUserSignInMethodsSnapshot | null;
};

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

  const linked = new Set(snapshot.linkedProviders);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-medium">{t("signInMethodsTitle")}</h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("signInMethodsHint")}</p>
      </div>

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
          const isLinked = linked.has(provider);
          return (
            <li
              key={provider}
              className="flex flex-col gap-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
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
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
