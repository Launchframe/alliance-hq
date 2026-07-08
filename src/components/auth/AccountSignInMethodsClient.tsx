"use client";

import { useCallback, useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import type {
  LinkedOAuthProvider,
  OAuthProviderAccountSnapshot,
} from "@/lib/auth/account-linking.shared";

type LinkedAccountsResponse = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
  oauthAccounts: OAuthProviderAccountSnapshot[];
  availableProviders: {
    google: boolean;
    discord: boolean;
  };
};

function resolveLinkErrorMessage(
  linkError: string | null | undefined,
  tAuth: (key: string) => string,
): string | null {
  switch (linkError?.trim()) {
    case "OAuthAccountAlreadyLinked":
      return tAuth("errorOAuthAccountAlreadyLinkedBody");
    case "OAuthProviderTypeAlreadyLinked":
      return tAuth("errorOAuthProviderTypeAlreadyLinkedBody");
    case "OAuthAccountNotLinked":
      return tAuth("errorOAuthAccountNotLinkedBody");
    default:
      return null;
  }
}

function oauthAccountForProvider(
  accounts: OAuthProviderAccountSnapshot[],
  provider: LinkedOAuthProvider,
): OAuthProviderAccountSnapshot | undefined {
  return accounts.find((row) => row.provider === provider);
}

type Props = {
  initialSnapshot: LinkedAccountsResponse;
  linkNotice?: LinkedOAuthProvider | null;
  linkError?: string | null;
};

export function AccountSignInMethodsClient({
  initialSnapshot,
  linkNotice,
  linkError,
}: Props) {
  const t = useTranslations("accountSecurity");
  const tAuth = useTranslations("auth");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busyProvider, setBusyProvider] = useState<LinkedOAuthProvider | null>(
    null,
  );
  const [pendingUnlink, setPendingUnlink] = useState<LinkedOAuthProvider | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(
    linkNotice ? t("linkedProviderSuccess", { provider: providerLabel(t, linkNotice) }) : null,
  );
  const [error, setError] = useState<string | null>(
    resolveLinkErrorMessage(linkError, tAuth),
  );

  const loadSnapshot = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/linked-accounts");
      if (!res.ok) {
        setError(t("linkedAccountsLoadFailed"));
        return;
      }
      const body = (await res.json()) as LinkedAccountsResponse;
      setSnapshot(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("linkedAccountsLoadFailed"));
    }
  }, [t]);

  async function linkProvider(provider: LinkedOAuthProvider) {
    setBusyProvider(provider);
    setError(null);
    setMessage(null);
    try {
      await signIn(provider, {
        callbackUrl: `/settings/account?linked=${provider}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("linkProviderFailed"));
      setBusyProvider(null);
    }
  }

  async function unlinkProvider(provider: LinkedOAuthProvider) {
    setBusyProvider(provider);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/linked-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (res.status === 409) {
        setError(t("unlinkLastMethodBlocked"));
        return;
      }
      if (!res.ok) {
        setError(t("unlinkProviderFailed"));
        return;
      }
      setMessage(t("unlinkProviderSuccess", { provider: providerLabel(t, provider) }));
      setPendingUnlink(null);
      await loadSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unlinkProviderFailed"));
    } finally {
      setBusyProvider(null);
    }
  }

  const linked = new Set(snapshot.linkedProviders);
  const discordLinked = linked.has("discord");

  return (
    <section className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("signInMethodsTitle")}</h2>
      <p className="text-sm text-hq-fg-muted">{t("signInMethodsBody")}</p>
      <p className="text-sm text-hq-fg-muted">{t("wrongProviderHint")}</p>

      {discordLinked ? (
        <p
          className="rounded-lg border border-hq-discord/35 bg-hq-discord/10 px-3 py-2.5 text-sm leading-snug text-hq-fg"
          role="status"
        >
          {t("discordBotReadyHint")}
        </p>
      ) : null}

      <ul className="space-y-3 text-sm">
        <li className="flex flex-col gap-2 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-hq-fg">{t("methodEmailMagicLink")}</p>
            <p className="text-hq-fg-muted">{snapshot.email}</p>
          </div>
          <span className="text-xs text-hq-green">{t("methodAlwaysAvailable")}</span>
        </li>

        <li className="flex flex-col gap-2 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-hq-fg">{t("methodPassword")}</p>
            <p className="text-hq-fg-muted">
              {snapshot.hasPassword ? t("methodConnected") : t("methodNotSet")}
            </p>
          </div>
        </li>

        <li className="flex flex-col gap-2 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-hq-fg">{t("methodPasskey")}</p>
            <p className="text-hq-fg-muted">
              {snapshot.passkeyCount > 0
                ? t("passkeySectionBodyCount", { count: snapshot.passkeyCount })
                : t("methodNotSet")}
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
              className="flex flex-col gap-2 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-hq-fg">
                  {providerLabel(t, provider)}
                </p>
                <p className="text-hq-fg-muted">
                  {isLinked ? t("methodConnected") : t("methodNotLinked")}
                </p>
                {account?.providerEmail ? (
                  <p className="mt-0.5 truncate text-xs text-hq-fg-muted">
                    {t("providerEmailOnFile", { email: account.providerEmail })}
                  </p>
                ) : null}
              </div>
              {isLinked ? (
                pendingUnlink === provider ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyProvider !== null}
                      onClick={() => void unlinkProvider(provider)}
                      className="rounded-lg border border-hq-danger bg-hq-danger/10 px-3 py-1.5 text-xs text-hq-danger disabled:opacity-50"
                    >
                      {busyProvider === provider ? t("saving") : t("confirmUnlink")}
                    </button>
                    <button
                      type="button"
                      disabled={busyProvider !== null}
                      onClick={() => setPendingUnlink(null)}
                      className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg disabled:opacity-50"
                    >
                      {t("cancelUnlink")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busyProvider !== null}
                    onClick={() => setPendingUnlink(provider)}
                    className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:border-hq-danger disabled:opacity-50"
                  >
                    {t("unlinkProvider")}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={busyProvider !== null}
                  onClick={() => void linkProvider(provider)}
                  className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {busyProvider === provider
                    ? t("saving")
                    : t("linkProvider", { provider: providerLabel(t, provider) })}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {message ? <p className="text-sm text-hq-green">{message}</p> : null}
      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}
    </section>
  );
}

function providerLabel(
  t: ReturnType<typeof useTranslations<"accountSecurity">>,
  provider: LinkedOAuthProvider,
): string {
  return provider === "google" ? t("methodGoogle") : t("methodDiscord");
}
